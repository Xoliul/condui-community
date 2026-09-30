import type { ModulePlacement } from './panelGridLayout'

export type WirePathPoint = { x: number; y: number }

export type WirePathSegment = {
  from: WirePathPoint
  to: WirePathPoint
  /** Scene connector endpoints, never its intermediate corridor bends. */
  fromPortal?: boolean
  toPortal?: boolean
  fromSurfaceId?: string
  toSurfaceId?: string
}

export type WirePathDebug = {
  cost: number
  bends: number
  visitedNodes: number
  usedFallback: boolean
  pathwayEdges: WirePathSegment[]
}

export type WirePathResult = {
  points: number[]
  debug: WirePathDebug
}

/** One board-level ladder: side corridors plus one horizontal corridor per row gap. */
export type PanelWirePathRegion = {
  id: string
  surfaceId?: string
  left: number
  right: number
  horizontalYs: number[]
}

export type WirePathOptions = {
  /** Preserve semantic gates and endpoint approaches encoded as turns in the intent guide. */
  preserveGuideTurns?: boolean
  /** Previously chosen routes; crossing and overlapping them adds congestion cost. */
  reservedSegments?: WirePathSegment[]
  /** Full semantic guide retained while routing one leg between required turns. */
  pathwayGuidePoints?: number[]
  /** Explicit board ladders supplied by the hierarchy scene. */
  pathwayRegions?: PanelWirePathRegion[]
  /** Explicit links between board ladders, normally derived from hierarchy scene connectors. */
  pathwayLinks?: WirePathSegment[]
  /** Split row corridors into directed lanes, including when a wire turns back along a row. */
  separateHorizontalLanes?: boolean
}

type Rect = { left: number; top: number; right: number; bottom: number }
type Direction = 'horizontal' | 'vertical' | 'start'
type GraphNode = WirePathPoint & { id: number; xi: number; yi: number }
type QueueEntry = { stateKey: string; nodeId: number; direction: Direction; cost: number }
type PathwaySegment = WirePathSegment & { horizontalDirection?: number }
type HorizontalLane = { centerY: number; y: number; direction: number }

const CLEARANCE = 4
const DIRECTIONAL_LANE_OFFSET = 3
const BEND_COST = 22
const GUIDE_DISTANCE_WEIGHT = 0.08
const CROSSING_COST = 90
const OVERLAP_COST = 8
const EPSILON = 0.01
const MAX_DEBUG_EDGES = 1200

function pointKey(point: WirePathPoint): string {
  return `${point.x.toFixed(2)},${point.y.toFixed(2)}`
}

function uniqueSorted(values: number[]): number[] {
  return [...new Set(values.map((value) => Math.round(value * 100) / 100))].sort((a, b) => a - b)
}

function toPoints(points: number[]): WirePathPoint[] {
  const result: WirePathPoint[] = []
  for (let index = 0; index <= points.length - 2; index += 2) {
    const x = points[index]
    const y = points[index + 1]
    if (x == null || y == null) continue
    result.push({ x, y })
  }
  return result
}

function toFlatPoints(points: WirePathPoint[]): number[] {
  return points.flatMap((point) => [point.x, point.y])
}

function containsPoint(rect: Rect, point: WirePathPoint): boolean {
  return (
    point.x > rect.left + EPSILON &&
    point.x < rect.right - EPSILON &&
    point.y > rect.top + EPSILON &&
    point.y < rect.bottom - EPSILON
  )
}

function pointTouchesPlacement(placement: ModulePlacement, point: WirePathPoint): boolean {
  return (
    point.x >= placement.x - EPSILON &&
    point.x <= placement.x + placement.width + EPSILON &&
    point.y >= placement.y - EPSILON &&
    point.y <= placement.y + placement.height + EPSILON
  )
}

function segmentCrossesRect(from: WirePathPoint, to: WirePathPoint, rect: Rect): boolean {
  if (Math.abs(from.y - to.y) <= EPSILON) {
    if (from.y <= rect.top + EPSILON || from.y >= rect.bottom - EPSILON) return false
    const low = Math.min(from.x, to.x)
    const high = Math.max(from.x, to.x)
    return high > rect.left + EPSILON && low < rect.right - EPSILON
  }
  if (Math.abs(from.x - to.x) <= EPSILON) {
    if (from.x <= rect.left + EPSILON || from.x >= rect.right - EPSILON) return false
    const low = Math.min(from.y, to.y)
    const high = Math.max(from.y, to.y)
    return high > rect.top + EPSILON && low < rect.bottom - EPSILON
  }
  return true
}

function isClearSegment(from: WirePathPoint, to: WirePathPoint, obstacles: Rect[]): boolean {
  return !obstacles.some((obstacle) => segmentCrossesRect(from, to, obstacle))
}

function manhattan(from: WirePathPoint, to: WirePathPoint): number {
  return Math.abs(from.x - to.x) + Math.abs(from.y - to.y)
}

function directionalPanelLinks(
  links: WirePathSegment[],
  regions: PanelWirePathRegion[],
  source: WirePathPoint,
  target: WirePathPoint
): WirePathSegment[] {
  const nearestSurface = (point: WirePathPoint) => {
    let nearest: PanelWirePathRegion | undefined
    let distance = Infinity
    for (const region of regions) {
      if (!region.surfaceId || region.horizontalYs.length === 0) continue
      const candidateDistance = manhattan(point, {
        x: Math.max(region.left, Math.min(region.right, point.x)),
        y: Math.max(
          Math.min(...region.horizontalYs),
          Math.min(Math.max(...region.horizontalYs), point.y)
        ),
      })
      if (candidateDistance < distance) {
        nearest = region
        distance = candidateDistance
      }
    }
    return nearest?.surfaceId
  }
  const sourceSurface = nearestSurface(source)
  const targetSurface = nearestSurface(target)
  if (!sourceSurface || !targetSurface || sourceSurface === targetSurface) return links

  // Stable surface ordering gives reversed electrical connections opposite lanes,
  // even when routed independently for selection and hover. Offset perpendicular
  // to each connector leg and join the lanes at bends, without crossing there.
  const offset = sourceSurface < targetSurface ? DIRECTIONAL_LANE_OFFSET : -DIRECTIONAL_LANE_OFFSET
  const normals: WirePathPoint[] = []
  for (let start = 0; start < links.length;) {
    let end = start
    while (end + 1 < links.length && !links[end]!.toPortal && !links[end + 1]!.fromPortal &&
      pointKey(links[end]!.to) === pointKey(links[end + 1]!.from)) end += 1
    const first = links[start]!.from
    const last = links[end]!.to
    // Reciprocal scene connectors may declare the same corridor in reverse.
    // Normalize their orientation so both still describe the same chosen lane.
    const direction = first.x < last.x || (first.x === last.x && first.y < last.y) ? 1 : -1
    for (let index = start; index <= end; index += 1) {
      const { from, to } = links[index]!
      normals.push({
        x: -Math.sign(to.y - from.y) * offset * direction,
        y: Math.sign(to.x - from.x) * offset * direction,
      })
    }
    start = end + 1
  }
  return links.map((link, index) => {
    const normal = normals[index]!
    const shift = (point: WirePathPoint, neighborIndex: number, portal?: boolean) => {
      const neighbor = links[neighborIndex]
      const neighborNormal = normals[neighborIndex]
      const sharedPoint = neighborIndex < index ? neighbor?.to : neighbor?.from
      const join = !portal && sharedPoint && pointKey(sharedPoint) === pointKey(point) &&
        neighborNormal && (normal.x === 0) !== (neighborNormal.x === 0)
      return {
        x: point.x + normal.x + (join ? neighborNormal.x : 0),
        y: point.y + normal.y + (join ? neighborNormal.y : 0),
      }
    }
    return {
      ...link,
      from: shift(link.from, index - 1, link.fromPortal),
      to: shift(link.to, index + 1, link.toPortal),
    }
  })
}

function distanceToSegment(point: WirePathPoint, segment: WirePathSegment): number {
  if (Math.abs(segment.from.x - segment.to.x) <= EPSILON) {
    const low = Math.min(segment.from.y, segment.to.y)
    const high = Math.max(segment.from.y, segment.to.y)
    return (
      Math.abs(point.x - segment.from.x) +
      (point.y < low ? low - point.y : point.y > high ? point.y - high : 0)
    )
  }
  const low = Math.min(segment.from.x, segment.to.x)
  const high = Math.max(segment.from.x, segment.to.x)
  return (
    Math.abs(point.y - segment.from.y) +
    (point.x < low ? low - point.x : point.x > high ? point.x - high : 0)
  )
}

function guideDistance(from: WirePathPoint, to: WirePathPoint, guide: WirePathSegment[]): number {
  if (guide.length === 0) return 0
  const midpoint = { x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 }
  return Math.min(...guide.map((segment) => distanceToSegment(midpoint, segment)))
}

function segmentInteractionCost(candidate: WirePathSegment, reserved: WirePathSegment[]): number {
  let cost = 0
  const candidateVertical = Math.abs(candidate.from.x - candidate.to.x) <= EPSILON
  for (const segment of reserved) {
    const reservedVertical = Math.abs(segment.from.x - segment.to.x) <= EPSILON
    if (candidateVertical !== reservedVertical) {
      const vertical = candidateVertical ? candidate : segment
      const horizontal = candidateVertical ? segment : candidate
      const verticalLow = Math.min(vertical.from.y, vertical.to.y)
      const verticalHigh = Math.max(vertical.from.y, vertical.to.y)
      const horizontalLow = Math.min(horizontal.from.x, horizontal.to.x)
      const horizontalHigh = Math.max(horizontal.from.x, horizontal.to.x)
      if (
        vertical.from.x >= horizontalLow - EPSILON &&
        vertical.from.x <= horizontalHigh + EPSILON &&
        horizontal.from.y > verticalLow + EPSILON &&
        horizontal.from.y < verticalHigh - EPSILON
      ) {
        cost += CROSSING_COST
      }
      continue
    }
    if (candidateVertical && Math.abs(candidate.from.x - segment.from.x) <= EPSILON) {
      const overlap =
        Math.min(
          Math.max(candidate.from.y, candidate.to.y),
          Math.max(segment.from.y, segment.to.y)
        ) -
        Math.max(Math.min(candidate.from.y, candidate.to.y), Math.min(segment.from.y, segment.to.y))
      if (overlap > EPSILON) cost += OVERLAP_COST
    } else if (!candidateVertical && Math.abs(candidate.from.y - segment.from.y) <= EPSILON) {
      const overlap =
        Math.min(
          Math.max(candidate.from.x, candidate.to.x),
          Math.max(segment.from.x, segment.to.x)
        ) -
        Math.max(Math.min(candidate.from.x, candidate.to.x), Math.min(segment.from.x, segment.to.x))
      if (overlap > EPSILON) cost += OVERLAP_COST
    }
  }
  return cost
}

function simplify(points: WirePathPoint[]): WirePathPoint[] {
  const deduped = points.filter(
    (point, index) => index === 0 || pointKey(point) !== pointKey(points[index - 1]!)
  )
  if (deduped.length <= 2) return deduped
  const result: WirePathPoint[] = [deduped[0]!]
  for (let index = 1; index < deduped.length - 1; index += 1) {
    const previous = result[result.length - 1]!
    const current = deduped[index]!
    const next = deduped[index + 1]!
    const collinear =
      (Math.abs(previous.x - current.x) <= EPSILON && Math.abs(current.x - next.x) <= EPSILON) ||
      (Math.abs(previous.y - current.y) <= EPSILON && Math.abs(current.y - next.y) <= EPSILON)
    if (!collinear) result.push(current)
  }
  result.push(deduped[deduped.length - 1]!)
  return result
}

function countBends(points: WirePathPoint[]): number {
  let bends = 0
  let previousDirection: Direction = 'start'
  for (let index = 1; index < points.length; index += 1) {
    const previous = points[index - 1]!
    const current = points[index]!
    const direction: Direction =
      Math.abs(previous.x - current.x) <= EPSILON ? 'vertical' : 'horizontal'
    if (previousDirection !== 'start' && previousDirection !== direction) bends += 1
    previousDirection = direction
  }
  return bends
}

class MinQueue {
  private readonly entries: QueueEntry[] = []

  push(entry: QueueEntry) {
    this.entries.push(entry)
    let index = this.entries.length - 1
    while (index > 0) {
      const parent = Math.floor((index - 1) / 2)
      if (this.entries[parent]!.cost <= entry.cost) break
      this.entries[index] = this.entries[parent]!
      index = parent
    }
    this.entries[index] = entry
  }

  pop(): QueueEntry | undefined {
    const first = this.entries[0]
    const last = this.entries.pop()
    if (!first || !last || this.entries.length === 0) return first
    let index = 0
    while (index < this.entries.length) {
      const left = index * 2 + 1
      const right = left + 1
      if (left >= this.entries.length) break
      const child =
        right < this.entries.length && this.entries[right]!.cost < this.entries[left]!.cost
          ? right
          : left
      if (this.entries[child]!.cost >= last.cost) break
      this.entries[index] = this.entries[child]!
      index = child
    }
    this.entries[index] = last
    return first
  }

  get size() {
    return this.entries.length
  }
}

/**
 * Route one orthogonal panel wire through a scene-derived pathway graph.
 * The legacy guide is a preference only: obstacles and total route cost decide the final path.
 */
export function routePanelWire(
  guidePoints: number[],
  placements: ModulePlacement[],
  options: WirePathOptions = {}
): WirePathResult {
  const guidePointsList = toPoints(guidePoints)
  const source = guidePointsList[0]
  const target = guidePointsList[guidePointsList.length - 1]
  if (!source || !target || guidePointsList.length < 2) {
    return {
      points: guidePoints,
      debug: { cost: 0, bends: 0, visitedNodes: 0, usedFallback: true, pathwayEdges: [] },
    }
  }

  if (options.preserveGuideTurns && guidePointsList.length > 2) {
    const anchors: WirePathPoint[] = [guidePointsList[0]!]
    for (let index = 1; index < guidePointsList.length - 1; index += 1) {
      const previous = guidePointsList[index - 1]!
      const current = guidePointsList[index]!
      const next = guidePointsList[index + 1]!
      const directionBefore =
        Math.abs(previous.x - current.x) <= EPSILON ? 'vertical' : 'horizontal'
      const directionAfter = Math.abs(current.x - next.x) <= EPSILON ? 'vertical' : 'horizontal'
      if (directionBefore !== directionAfter) anchors.push(current)
    }
    anchors.push(guidePointsList[guidePointsList.length - 1]!)

    const combinedPoints: WirePathPoint[] = []
    const pathwayEdges: WirePathSegment[] = []
    let cost = 0
    let visitedNodes = 0
    let usedFallback = false
    for (let index = 1; index < anchors.length; index += 1) {
      const from = anchors[index - 1]!
      const to = anchors[index]!
      const leg = routePanelWire([from.x, from.y, to.x, to.y], placements, {
        reservedSegments: options.reservedSegments,
        pathwayGuidePoints: guidePoints,
        pathwayRegions: options.pathwayRegions,
        pathwayLinks: options.pathwayLinks,
        separateHorizontalLanes: options.separateHorizontalLanes,
      })
      const legPoints = toPoints(leg.points)
      combinedPoints.push(...(index === 1 ? legPoints : legPoints.slice(1)))
      cost += leg.debug.cost
      visitedNodes += leg.debug.visitedNodes
      usedFallback ||= leg.debug.usedFallback
      if (pathwayEdges.length < MAX_DEBUG_EDGES) {
        pathwayEdges.push(...leg.debug.pathwayEdges.slice(0, MAX_DEBUG_EDGES - pathwayEdges.length))
      }
    }
    const routedPoints = simplify(combinedPoints)
    return {
      points: toFlatPoints(routedPoints),
      debug: {
        cost,
        bends: countBends(routedPoints),
        visitedNodes,
        usedFallback,
        pathwayEdges,
      },
    }
  }

  const pathwayGuidePointsList = options.pathwayGuidePoints
    ? toPoints(options.pathwayGuidePoints)
    : guidePointsList
  const routeBounds = {
    left: Math.min(...pathwayGuidePointsList.map((point) => point.x)) - 60,
    top: Math.min(...pathwayGuidePointsList.map((point) => point.y)) - 60,
    right: Math.max(...pathwayGuidePointsList.map((point) => point.x)) + 60,
    bottom: Math.max(...pathwayGuidePointsList.map((point) => point.y)) + 60,
  }
  const sceneRects = placements
    .map((placement) => {
      const rect = {
        placement,
        left: placement.x - CLEARANCE,
        top: placement.y - CLEARANCE,
        right: placement.x + placement.width + CLEARANCE,
        bottom: placement.y + placement.height + CLEARANCE,
      }
      for (const endpoint of [source, target]) {
        if (pointTouchesPlacement(placement, endpoint)) continue
        if (endpoint.x >= placement.x + placement.width && endpoint.x < rect.right) {
          rect.right = endpoint.x
        } else if (endpoint.x <= placement.x && endpoint.x > rect.left) {
          rect.left = endpoint.x
        }
        if (endpoint.y >= placement.y + placement.height && endpoint.y < rect.bottom) {
          rect.bottom = endpoint.y
        } else if (endpoint.y <= placement.y && endpoint.y > rect.top) {
          rect.top = endpoint.y
        }
      }
      return rect
    })
    .filter(
      (rect) =>
        rect.right >= routeBounds.left &&
        rect.left <= routeBounds.right &&
        rect.bottom >= routeBounds.top &&
        rect.top <= routeBounds.bottom
    )
  const obstacles = sceneRects
    .filter(
      ({ placement }) =>
        !pointTouchesPlacement(placement, source) && !pointTouchesPlacement(placement, target)
    )
    .map(({ placement: _placement, ...rect }) => rect)
  const guideSegments = pathwayGuidePointsList
    .slice(1)
    .map((point, index) => ({
      from: pathwayGuidePointsList[index]!,
      to: point,
    }))
    .filter((segment) => pointKey(segment.from) !== pointKey(segment.to))

  // Fallback for non-scene callers: collapse modules into row bands. Normal panel rendering
  // supplies explicit board ladders, so module geometry never creates extra global lanes.
  const rowBands = sceneRects
    .map((rect) => ({ top: rect.top, bottom: rect.bottom }))
    .sort((a, b) => a.top - b.top)
    .reduce<Array<{ top: number; bottom: number }>>((bands, band) => {
      const previous = bands[bands.length - 1]
      if (previous && band.top <= previous.bottom + EPSILON) {
        previous.bottom = Math.max(previous.bottom, band.bottom)
      } else {
        bands.push({ ...band })
      }
      return bands
    }, [])
  const horizontalGuideYs = guideSegments
    .filter((segment) => Math.abs(segment.from.y - segment.to.y) <= EPSILON)
    .map((segment) => segment.from.y)
  const inferredHorizontalLaneYs = uniqueSorted([
    ...horizontalGuideYs,
    ...rowBands.slice(1).map((band, index) => (rowBands[index]!.bottom + band.top) / 2),
    ...(rowBands[0] ? [rowBands[0].top - CLEARANCE * 2] : []),
    ...(rowBands[rowBands.length - 1]
      ? [rowBands[rowBands.length - 1]!.bottom + CLEARANCE * 2]
      : []),
  ])
  const contentLeft =
    sceneRects.length > 0 ? Math.min(...sceneRects.map((rect) => rect.left)) : routeBounds.left
  const contentRight =
    sceneRects.length > 0 ? Math.max(...sceneRects.map((rect) => rect.right)) : routeBounds.right
  const inferredSideCorridorXs = uniqueSorted([
    contentLeft - CLEARANCE * 2,
    contentRight + CLEARANCE * 2,
    ...guideSegments
      .filter(
        (segment) =>
          Math.abs(segment.from.x - segment.to.x) <= EPSILON &&
          (segment.from.x <= contentLeft + EPSILON || segment.from.x >= contentRight - EPSILON)
      )
      .map((segment) => segment.from.x),
  ])
  const originalRegions = options.pathwayRegions?.filter((region) => region.horizontalYs.length >= 1) ?? []
  const lanesByRegion = new Map<string, HorizontalLane[]>()
  const regions = originalRegions.map((region) => {
    const lanes = region.horizontalYs.flatMap((centerY) =>
      (options.separateHorizontalLanes ? [-1, 1] : [0]).map((direction) => {
        const shiftedY = centerY + direction * DIRECTIONAL_LANE_OFFSET
        // Keep narrow corridors usable if a directional lane would hit a module.
        const y = isClearSegment({ x: region.left, y: shiftedY },
          { x: region.right, y: shiftedY }, obstacles) ? shiftedY : centerY
        return { centerY, y, direction }
      })
    )
    lanesByRegion.set(region.id, lanes)
    return { ...region, horizontalYs: uniqueSorted(lanes.map((lane) => lane.y)) }
  })
  const links = directionalPanelLinks(options.pathwayLinks ?? [], originalRegions, source, target)
  const nearestRegionLanePoints = (point: WirePathPoint, surfaceId?: string) => {
    const nearest = originalRegions
      .filter((region) => surfaceId != null ? region.surfaceId === surfaceId :
        point.x >= region.left - EPSILON && point.x <= region.right + EPSILON)
      .flatMap((region) => region.horizontalYs.map((y) => ({
        region, x: Math.max(region.left, Math.min(region.right, point.x)), y,
      })))
      .sort((a, b) => manhattan(point, a) - manhattan(point, b))[0]
    if (!nearest) return []
    return uniqueSorted(lanesByRegion.get(nearest.region.id)!
      .filter((lane) => lane.centerY === nearest.y).map((lane) => lane.y))
      .map((y) => ({ x: nearest.x, y }))
  }
  const horizontalLaneYs =
    regions.length > 0
      ? uniqueSorted(regions.flatMap((region) => region.horizontalYs))
      : inferredHorizontalLaneYs
  const minPathX = Math.min(
    source.x,
    target.x,
    ...inferredSideCorridorXs,
    ...pathwayGuidePointsList.map((point) => point.x)
  )
  const maxPathX = Math.max(
    source.x,
    target.x,
    ...inferredSideCorridorXs,
    ...pathwayGuidePointsList.map((point) => point.x)
  )
  const minPathY = Math.min(
    source.y,
    target.y,
    ...horizontalLaneYs,
    ...pathwayGuidePointsList.map((point) => point.y)
  )
  const maxPathY = Math.max(
    source.y,
    target.y,
    ...horizontalLaneYs,
    ...pathwayGuidePointsList.map((point) => point.y)
  )

  const basePathways: PathwaySegment[] =
    regions.length > 0
      ? regions
          .flatMap((region) => {
            const ys = uniqueSorted(region.horizontalYs)
            const top = ys[0]!
            const bottom = ys[ys.length - 1]!
            return [
              ...lanesByRegion.get(region.id)!.map(({ y, direction }) => ({
                from: { x: region.left, y }, to: { x: region.right, y },
                horizontalDirection: direction,
              })),
              { from: { x: region.left, y: top }, to: { x: region.left, y: bottom } },
              { from: { x: region.right, y: top }, to: { x: region.right, y: bottom } },
            ]
          })
          .concat(links)
      : [
          ...horizontalLaneYs.map((y) => ({ from: { x: minPathX, y }, to: { x: maxPathX, y } })),
          ...inferredSideCorridorXs.map((x) => ({
            from: { x, y: minPathY },
            to: { x, y: maxPathY },
          })),
          ...guideSegments,
        ]
  if (regions.length > 1) {
    const ordered = [...regions].sort(
      (a, b) => Math.min(...a.horizontalYs) - Math.min(...b.horizontalYs)
    )
    for (let index = 1; index < ordered.length; index += 1) {
      const upper = ordered[index - 1]!
      const lower = ordered[index]!
      // Explicit scene links own all transitions between separate enclosures.
      if (options.pathwayLinks != null &&
        (!upper.surfaceId || upper.surfaceId !== lower.surfaceId)) continue
      const upperBottom = Math.max(...upper.horizontalYs)
      const lowerTop = Math.min(...lower.horizontalYs)
      const overlapLeft = Math.max(upper.left, lower.left)
      const overlapRight = Math.min(upper.right, lower.right)
      if (lowerTop <= upperBottom || overlapLeft > overlapRight) continue
      const linkX = (overlapLeft + overlapRight) / 2
      basePathways.push({ from: { x: linkX, y: upperBottom }, to: { x: linkX, y: lowerTop } })
    }
  }
  const addShortAccess = (point: WirePathPoint) => {
    if (regions.length > 0) {
      for (const lanePoint of nearestRegionLanePoints(point)) {
        basePathways.push({ from: point, to: lanePoint })
      }
      return
    }
    const nearestLaneY = horizontalLaneYs.reduce<number | null>((nearest, y) => {
      if (nearest == null) return y
      return Math.abs(y - point.y) < Math.abs(nearest - point.y) ? y : nearest
    }, null)
    if (nearestLaneY == null) return
    basePathways.push({
      from: point,
      to: { x: point.x, y: nearestLaneY },
    })
  }
  addShortAccess(source)
  addShortAccess(target)

  // Hierarchy connectors terminate at panel frames, while board ladders live in the
  // row gaps inside those frames. Join each connector portal to its nearest ladder
  // without opening an unrestricted vertical lane through the whole scene.
  if (regions.length > 0) {
    const addNearestPathwayAccess = (point: WirePathPoint, surfaceId?: string) => {
      const lanePoints = nearestRegionLanePoints(point, surfaceId)
      // Side portals enter horizontally, then follow the board's side corridor.
      for (const lanePoint of lanePoints) {
        const approach = { x: lanePoint.x, y: point.y }
        basePathways.push({ from: point, to: approach }, { from: approach, to: lanePoint })
      }
    }
    const hasExplicitPortals = links.some((link) => link.fromPortal || link.toPortal)
    for (const link of links) {
      // Legacy callers have no endpoint metadata; only unshared chain ends are portals.
      const isChainEnd = (point: WirePathPoint) => links.reduce((count, candidate) =>
        count + Number(pointKey(candidate.from) === pointKey(point)) +
        Number(pointKey(candidate.to) === pointKey(point)), 0) === 1
      if (hasExplicitPortals ? link.fromPortal : isChainEnd(link.from)) {
        addNearestPathwayAccess(link.from, link.fromSurfaceId)
      }
      if (hasExplicitPortals ? link.toPortal : isChainEnd(link.to)) {
        addNearestPathwayAccess(link.to, link.toSurfaceId)
      }
    }
  }

  const pointOnSegment = (point: WirePathPoint, segment: WirePathSegment): boolean => {
    if (Math.abs(segment.from.x - segment.to.x) <= EPSILON) {
      return (
        Math.abs(point.x - segment.from.x) <= EPSILON &&
        point.y >= Math.min(segment.from.y, segment.to.y) - EPSILON &&
        point.y <= Math.max(segment.from.y, segment.to.y) + EPSILON
      )
    }
    return (
      Math.abs(point.y - segment.from.y) <= EPSILON &&
      point.x >= Math.min(segment.from.x, segment.to.x) - EPSILON &&
      point.x <= Math.max(segment.from.x, segment.to.x) + EPSILON
    )
  }
  const intersection = (a: WirePathSegment, b: WirePathSegment): WirePathPoint | null => {
    const aVertical = Math.abs(a.from.x - a.to.x) <= EPSILON
    const bVertical = Math.abs(b.from.x - b.to.x) <= EPSILON
    if (aVertical === bVertical) return null
    const vertical = aVertical ? a : b
    const horizontal = aVertical ? b : a
    const point = { x: vertical.from.x, y: horizontal.from.y }
    return pointOnSegment(point, a) && pointOnSegment(point, b) ? point : null
  }

  const nodes: GraphNode[] = []
  const nodeByPoint = new Map<string, GraphNode>()
  const getNode = (point: WirePathPoint): GraphNode => {
    const key = pointKey(point)
    const existing = nodeByPoint.get(key)
    if (existing) return existing
    const node = { ...point, id: nodes.length, xi: 0, yi: 0 }
    nodes.push(node)
    nodeByPoint.set(key, node)
    return node
  }

  const pathwayEdges: WirePathSegment[] = []
  const adjacency = new Map<
    number,
    Array<{ nodeId: number; direction: Exclude<Direction, 'start'> }>
  >()
  const addEdge = (
    from: GraphNode, to: GraphNode, direction: Exclude<Direction, 'start'>,
    horizontalDirection = 0
  ) => {
    if (!isClearSegment(from, to, obstacles)) return
    const fromEdges = adjacency.get(from.id) ?? []
    if (horizontalDirection >= 0) fromEdges.push({ nodeId: to.id, direction })
    adjacency.set(from.id, fromEdges)
    const toEdges = adjacency.get(to.id) ?? []
    if (horizontalDirection <= 0) toEdges.push({ nodeId: from.id, direction })
    adjacency.set(to.id, toEdges)
    if (pathwayEdges.length < MAX_DEBUG_EDGES) pathwayEdges.push({ from, to })
  }

  for (const segment of basePathways) {
    const splitPoints = [segment.from, segment.to]
    for (const other of basePathways) {
      const crossing = intersection(segment, other)
      if (crossing) splitPoints.push(crossing)
      if (pointOnSegment(other.from, segment)) splitPoints.push(other.from)
      if (pointOnSegment(other.to, segment)) splitPoints.push(other.to)
    }
    const vertical = Math.abs(segment.from.x - segment.to.x) <= EPSILON
    const sorted = [...new Map(splitPoints.map((point) => [pointKey(point), point])).values()]
      .filter((point) => !obstacles.some((obstacle) => containsPoint(obstacle, point)))
      .sort((a, b) => (vertical ? a.y - b.y : a.x - b.x))
    for (let index = 1; index < sorted.length; index += 1) {
      addEdge(
        getNode(sorted[index - 1]!),
        getNode(sorted[index]!),
        vertical ? 'vertical' : 'horizontal',
        segment.horizontalDirection
      )
    }
  }

  const sourceNode = nodeByPoint.get(pointKey(source))
  const targetNode = nodeByPoint.get(pointKey(target))
  if (!sourceNode || !targetNode) {
    return {
      points: guidePoints,
      debug: {
        cost: 0,
        bends: countBends(guidePointsList),
        visitedNodes: 0,
        usedFallback: true,
        pathwayEdges,
      },
    }
  }

  const queue = new MinQueue()
  const distances = new Map<string, number>()
  const previousState = new Map<string, string>()
  const stateNode = new Map<string, number>()
  const startKey = `${sourceNode.id}:start`
  distances.set(startKey, 0)
  stateNode.set(startKey, sourceNode.id)
  queue.push({ stateKey: startKey, nodeId: sourceNode.id, direction: 'start', cost: 0 })
  let winnerKey: string | null = null
  let visitedNodes = 0

  while (queue.size > 0) {
    const current = queue.pop()!
    if (current.cost !== distances.get(current.stateKey)) continue
    visitedNodes += 1
    if (current.nodeId === targetNode.id) {
      winnerKey = current.stateKey
      break
    }
    const currentNode = nodes[current.nodeId]!
    for (const edge of adjacency.get(current.nodeId) ?? []) {
      const nextNode = nodes[edge.nodeId]!
      const bendCost =
        current.direction !== 'start' && current.direction !== edge.direction ? BEND_COST : 0
      const guideCost = guideDistance(currentNode, nextNode, guideSegments) * GUIDE_DISTANCE_WEIGHT
      const congestionCost = segmentInteractionCost(
        { from: currentNode, to: nextNode },
        options.reservedSegments ?? []
      )
      const cost =
        current.cost + manhattan(currentNode, nextNode) + bendCost + guideCost + congestionCost
      const nextKey = `${edge.nodeId}:${edge.direction}`
      const known = distances.get(nextKey)
      if (known != null && known <= cost + EPSILON) continue
      distances.set(nextKey, cost)
      previousState.set(nextKey, current.stateKey)
      stateNode.set(nextKey, edge.nodeId)
      queue.push({ stateKey: nextKey, nodeId: edge.nodeId, direction: edge.direction, cost })
    }
  }

  if (!winnerKey) {
    return {
      points: guidePoints,
      debug: {
        cost: 0,
        bends: countBends(guidePointsList),
        visitedNodes,
        usedFallback: true,
        pathwayEdges,
      },
    }
  }

  const reversed: WirePathPoint[] = []
  let cursor: string | undefined = winnerKey
  while (cursor) {
    const nodeId = stateNode.get(cursor)
    if (nodeId != null) reversed.push(nodes[nodeId]!)
    cursor = previousState.get(cursor)
  }
  const routedPoints = simplify(reversed.reverse())
  return {
    points: toFlatPoints(routedPoints),
    debug: {
      cost: distances.get(winnerKey) ?? 0,
      bends: countBends(routedPoints),
      visitedNodes,
      usedFallback: false,
      pathwayEdges,
    },
  }
}
