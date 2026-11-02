import type { Point2 } from '@/types/schema'

export type RecognizedWallStrip = {
  sourceIndex: number
  points: [Point2, Point2]
  thickness?: number
}

const distance = (a: Point2, b: Point2) => Math.hypot(a.x - b.x, a.y - b.y)
const length = (wall: RecognizedWallStrip) => distance(...wall.points)
const dot = (a: Point2, b: Point2) => a.x * b.x + a.y * b.y
const subtract = (a: Point2, b: Point2) => ({ x: a.x - b.x, y: a.y - b.y })
const direction = (wall: RecognizedWallStrip) => {
  const delta = subtract(wall.points[1], wall.points[0])
  const size = length(wall) || 1
  return { x: delta.x / size, y: delta.y / size }
}
const pointAt = (wall: RecognizedWallStrip, along: number): Point2 => {
  const u = direction(wall)
  return { x: wall.points[0].x + along * u.x, y: wall.points[0].y + along * u.y }
}
const along = (wall: RecognizedWallStrip, point: Point2) =>
  dot(subtract(point, wall.points[0]), direction(wall))
const closest = (wall: RecognizedWallStrip, point: Point2) =>
  pointAt(wall, Math.max(0, Math.min(length(wall), along(wall, point))))

/** Scan-only simplification. Source indices survive so openings retain their owning wall.
 * Thickness is in centimetres; points use the calibrated canvas coordinate system.
 * Existing manually drawn walls never enter this pass.
 */
export function cleanRecognizedWalls(
  input: RecognizedWallStrip[],
  openingWallIndices: ReadonlySet<number>,
  pxPerMeter = 100
): RecognizedWallStrip[] {
  const unit = pxPerMeter / 100
  const walls = input.map((wall) => ({
    ...wall,
    points: wall.points.map((p) => ({ ...p })) as [Point2, Point2],
  }))
  // Length-weighted families prevent tiny mask fragments dominating the typical width.
  const families: Array<{ mean: number; weight: number; walls: RecognizedWallStrip[] }> = []
  for (const wall of [...walls].sort((a, b) => length(b) - length(a))) {
    if (!wall.thickness || !Number.isFinite(wall.thickness)) continue
    const width = wall.thickness
    const family = families.find((item) => Math.abs(item.mean - width) / item.mean <= 0.25)
    const weight = length(wall)
    if (family) {
      family.mean = (family.mean * family.weight + width * weight) / (family.weight + weight)
      family.weight += weight
      family.walls.push(wall)
    } else families.push({ mean: width, weight, walls: [wall] })
  }
  for (const family of families) {
    const standard = [10, 20].find((width) => Math.abs(family.mean - width) / width <= 0.3)
    // Unusual scales still produce a few consistent, rounded widths (44/47 -> 45).
    const width =
      standard ??
      Math.max(
        2,
        Math.round(family.mean / (family.mean >= 25 ? 5 : 1)) * (family.mean >= 25 ? 5 : 1)
      )
    for (const wall of family.walls) wall.thickness = width
  }
  const typical = [...families].sort((a, b) => b.weight - a.weight)[0]?.mean ?? 20
  const tolerance = Math.max(7, typical * 0.3) * unit
  // Snap nearly horizontal/vertical scans only when both ends move a small distance.
  for (const wall of walls) {
    const [a, b] = wall.points
    const dx = Math.abs(a.x - b.x),
      dy = Math.abs(a.y - b.y)
    if (dy <= tolerance && dy <= dx * Math.tan(Math.PI / 90)) {
      a.y = b.y = (a.y + b.y) / 2
    } else if (dx <= tolerance && dx <= dy * Math.tan(Math.PI / 90)) {
      a.x = b.x = (a.x + b.x) / 2
    }
  }
  // Anchor related parallel runs to their longest strip. Keep separate source walls,
  // including opening bridges, but eliminate small accidental offsets along a facade.
  const anchored = new Set<RecognizedWallStrip>()
  for (const base of [...walls].sort((a, b) => length(b) - length(a))) {
    if (anchored.has(base)) continue
    anchored.add(base)
    for (const other of walls) {
      if (anchored.has(other)) continue
      if (Math.abs(dot(direction(base), direction(other))) < Math.cos(Math.PI / 90)) continue
      const projected = other.points.map((point) => pointAt(base, along(base, point))) as [
        Point2,
        Point2,
      ]
      if (other.points.some((point, i) => distance(point, projected[i]!) > tolerance)) continue
      const ts = other.points.map((point) => along(base, point)).sort((a, b) => a - b)
      const gap = Math.max(ts[0]! - length(base), -ts[1]!, 0)
      if (gap > 120 * unit) continue
      other.points = projected
      anchored.add(other)
    }
  }
  const kept = walls.filter((wall) => {
    if (
      openingWallIndices.has(wall.sourceIndex) ||
      length(wall) > Math.min(60, typical * 3) * unit ||
      (wall.thickness ?? typical) >= typical * 0.6
    )
      return true
    // Only remove thin, short, disconnected slivers; attached returns and piers survive.
    return walls.some(
      (other) =>
        other !== wall &&
        (wall.points.some((point) => distance(point, closest(other, point)) <= tolerance) ||
          other.points.some((point) => distance(point, closest(wall, point)) <= tolerance))
    )
  })
  // Crossing centerlines produce one exact L/T junction, even when both stop short.
  for (const wall of kept) {
    for (const end of [0, 1] as const) {
      const point = wall.points[end]
      const u = direction(wall)
      let best: Point2 | undefined
      let bestDistance = tolerance + 1e-6
      for (const other of kept) {
        if (wall === other) continue
        const v = direction(other)
        const cross = u.x * v.y - u.y * v.x
        if (Math.abs(cross) < 0.35) continue
        const delta = subtract(other.points[0], wall.points[0])
        const target = pointAt(wall, (delta.x * v.y - delta.y * v.x) / cross)
        const move = distance(point, target)
        if (move < bestDistance && distance(target, closest(other, target)) <= tolerance) {
          best = target
          bestDistance = move
        }
      }
      if (best) wall.points[end] = best
    }
  }
  // Near endpoints on the same line share the exact same coordinate as well.
  // Bound each cluster to its anchor; do not let chains of tiny gaps consume a doorway.
  const endpoints = kept.flatMap((wall) => wall.points.map((point, end) => ({ wall, point, end })))
  const assigned = new Set<(typeof endpoints)[number]>()
  for (const anchor of endpoints) {
    if (assigned.has(anchor)) continue
    const cluster = endpoints.filter(
      (item) =>
        !assigned.has(item) &&
        (item === anchor || item.wall !== anchor.wall) &&
        distance(item.point, anchor.point) <= tolerance
    )
    const center = {
      x: cluster.reduce((sum, item) => sum + item.point.x, 0) / cluster.length,
      y: cluster.reduce((sum, item) => sum + item.point.y, 0) / cluster.length,
    }
    for (const item of cluster) {
      item.wall.points[item.end as 0 | 1] = { ...center }
      assigned.add(item)
    }
  }
  return kept.filter((wall) => length(wall) > unit)
}
