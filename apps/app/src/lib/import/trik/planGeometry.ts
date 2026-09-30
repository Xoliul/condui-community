import type { Door, FloorPlan, Stair, Wall, Window } from '@/types/schema'
import { clamp, distance } from '@/lib/geometry'
import { generateId } from '@/utils/project'
import type { TrikBoogImportMode, TrikPoint, TrikWallSource } from '@/lib/import/trik/shared'
import {
  normalizeAngleRad,
  parseJaNeeBoolean,
  parseNumber,
  parsePoint,
  pointsEqual,
  scaledPoint,
  TRIK_ARC_MAX_CURVE_SWEEP_RAD,
  TRIK_ARC_MAX_SEGMENT_ANGLE_RAD,
  TRIK_ARC_MAX_SEGMENT_SOURCE_LENGTH,
  TRIK_BOOG_IMPORT_MODE,
  TRIK_TO_PLAN_SCALE,
} from '@/lib/import/trik/shared'

export type TrikArcGeometry = {
  center: TrikPoint
  radius: number
  startAngle: number
  /** Signed sweep from P1 toward P2 (or full turn when P1≈P2). */
  delta: number
  closedCircle: boolean
}

export type TrikArcCurveSegment = {
  start: TrikPoint
  control: TrikPoint
  end: TrikPoint
  weight: number
}

/**
 * Resolve TRiK Boog (P1, P2, Straal, Gespiegeld, Groot) into a circular arc.
 * P1≈P2 with a positive radius is treated as a full circle centered at that point.
 */
export function resolveTrikArcGeometry(
  p1: TrikPoint,
  p2: TrikPoint,
  radius: number,
  mirrored: boolean,
  largeArc: boolean,
): TrikArcGeometry | null {
  if (!(radius > 0) || !Number.isFinite(radius)) return null
  const chord = distance(p1, p2)
  if (chord <= 1e-6) {
    return {
      center: { ...p1 },
      radius,
      startAngle: 0,
      delta: mirrored ? -Math.PI * 2 : Math.PI * 2,
      closedCircle: true,
    }
  }

  const r = Math.max(radius, chord / 2)
  const halfChord = chord / 2
  const ux = (p2.x - p1.x) / chord
  const uy = (p2.y - p1.y) / chord
  const nx = -uy
  const ny = ux
  const mid = { x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 }
  const h = Math.sqrt(Math.max(0, r * r - halfChord * halfChord))
  // TRiK Gespiegeld selects the visual bulge side of the chord. For a minor arc the
  // center sits on that same side; for a major arc (Groot) the center is opposite the
  // bulge, so invert the side when placing the center.
  const centerOnMirroredSide = largeArc ? !mirrored : mirrored
  const center = centerOnMirroredSide
    ? { x: mid.x - nx * h, y: mid.y - ny * h }
    : { x: mid.x + nx * h, y: mid.y + ny * h }

  const startAngle = Math.atan2(p1.y - center.y, p1.x - center.x)
  const endAngle = Math.atan2(p2.y - center.y, p2.x - center.x)
  const ccw = normalizeAngleRad(endAngle - startAngle) // [0, 2pi)
  const shortDelta = ccw <= Math.PI ? ccw : ccw - 2 * Math.PI
  let delta = shortDelta
  if (largeArc) {
    if (Math.abs(delta) < Math.PI) delta = delta > 0 ? delta - 2 * Math.PI : delta + 2 * Math.PI
  } else if (Math.abs(delta) > Math.PI) {
    delta = delta > 0 ? delta - 2 * Math.PI : delta + 2 * Math.PI
  }

  return { center, radius: r, startAngle, delta, closedCircle: false }
}

/** Legacy fallback: approximate a Boog as a polyline of short chords. */
export function buildArcPolylinePoints(
  p1: TrikPoint,
  p2: TrikPoint,
  radius: number,
  mirrored: boolean,
  largeArc: boolean,
): TrikPoint[] {
  const geometry = resolveTrikArcGeometry(p1, p2, radius, mirrored, largeArc)
  if (!geometry) return [p1, p2]
  if (geometry.closedCircle) {
    // Previous polyline path ignored coincident endpoints; keep that behaviour here.
    return [p1, p2]
  }

  const { center, radius: r, startAngle, delta } = geometry
  const arcLength = Math.abs(delta) * r
  const byLength = Math.ceil(arcLength / TRIK_ARC_MAX_SEGMENT_SOURCE_LENGTH)
  const byAngle = Math.ceil(Math.abs(delta) / TRIK_ARC_MAX_SEGMENT_ANGLE_RAD)
  const segments = Math.max(2, byLength, byAngle)
  const points: TrikPoint[] = []
  for (let i = 0; i <= segments; i += 1) {
    const t = i / segments
    const angle = startAngle + delta * t
    points.push({
      x: center.x + Math.cos(angle) * r,
      y: center.y + Math.sin(angle) * r,
    })
  }
  // Keep exact endpoints from source.
  points[0] = p1
  points[points.length - 1] = p2
  return points
}

function pointOnCircle(center: TrikPoint, radius: number, angle: number): TrikPoint {
  return {
    x: center.x + Math.cos(angle) * radius,
    y: center.y + Math.sin(angle) * radius,
  }
}

/**
 * Exact circular-arc → rational-quadratic pieces (weight = cos(θ/2), control at tangent intersection).
 * Sweeps wider than {@link TRIK_ARC_MAX_CURVE_SWEEP_RAD} are split so each piece stays ≤ ~90°.
 */
export function buildArcRationalQuadraticSegments(
  p1: TrikPoint,
  p2: TrikPoint,
  radius: number,
  mirrored: boolean,
  largeArc: boolean,
  maxSweepRad: number = TRIK_ARC_MAX_CURVE_SWEEP_RAD,
): TrikArcCurveSegment[] {
  const geometry = resolveTrikArcGeometry(p1, p2, radius, mirrored, largeArc)
  if (!geometry) return []
  const sweepLimit = Math.max(1e-6, Math.min(Math.PI - 1e-6, maxSweepRad))
  const pieceCount = Math.max(1, Math.ceil(Math.abs(geometry.delta) / sweepLimit))
  const { center, radius: r, startAngle, delta, closedCircle } = geometry
  const direction = Math.sign(delta) || 1
  const segments: TrikArcCurveSegment[] = []

  for (let i = 0; i < pieceCount; i += 1) {
    const a0 = startAngle + delta * (i / pieceCount)
    const a1 = startAngle + delta * ((i + 1) / pieceCount)
    const sweep = a1 - a0
    const start =
      !closedCircle && i === 0
        ? p1
        : pointOnCircle(center, r, a0)
    const end =
      !closedCircle && i === pieceCount - 1
        ? p2
        : pointOnCircle(center, r, a1)

    // Unit tangents in the travel direction (perpendicular to radius).
    const t0 = { x: -Math.sin(a0) * direction, y: Math.cos(a0) * direction }
    const t1 = { x: -Math.sin(a1) * direction, y: Math.cos(a1) * direction }
    const dx = end.x - start.x
    const dy = end.y - start.y
    const det = t0.x * t1.y - t0.y * t1.x
    if (Math.abs(det) < 1e-12) continue
    const u = (dx * t1.y - dy * t1.x) / det
    const control = { x: start.x + u * t0.x, y: start.y + u * t0.y }
    const weight = Math.cos(Math.abs(sweep) / 2)
    if (!(weight > 0) || !Number.isFinite(weight)) continue
    if (![control.x, control.y].every(Number.isFinite)) continue

    segments.push({ start, control, end, weight })
  }

  return segments
}

function readBoogAttributes(arc: Element): {
  p1: TrikPoint
  p2: TrikPoint
  radius: number
  mirrored: boolean
  largeArc: boolean
} | null {
  const p1 = parsePoint(arc.querySelector(':scope > P1'))
  const p2 = parsePoint(arc.querySelector(':scope > P2'))
  const radius = parseNumber(arc.getAttribute('Straal'))
  if (!p1 || !p2 || !radius || radius <= 0) return null
  return {
    p1,
    p2,
    radius,
    mirrored: parseJaNeeBoolean(arc.getAttribute('Gespiegeld')) ?? false,
    largeArc: parseJaNeeBoolean(arc.getAttribute('Groot')) ?? false,
  }
}

export function parseSourceWalls(
  scope: Element,
  boogMode: TrikBoogImportMode = TRIK_BOOG_IMPORT_MODE,
): TrikWallSource[] {
  const walls: TrikWallSource[] = []
  for (const wall of Array.from(scope.querySelectorAll('GrondplanElementen > Muur'))) {
    const p1 = parsePoint(wall.querySelector(':scope > P1'))
    const p2 = parsePoint(wall.querySelector(':scope > P2'))
    if (!p1 || !p2) continue
    walls.push({ p1, p2 })
  }
  if (boogMode !== 'polyline') return walls
  for (const arc of Array.from(scope.querySelectorAll('GrondplanElementen > Boog'))) {
    const attrs = readBoogAttributes(arc)
    if (!attrs) continue
    const polyline = buildArcPolylinePoints(
      attrs.p1,
      attrs.p2,
      attrs.radius,
      attrs.mirrored,
      attrs.largeArc,
    )
    for (let i = 0; i < polyline.length - 1; i += 1) {
      const a = polyline[i]
      const b = polyline[i + 1]
      if (!a || !b) continue
      walls.push({ p1: a, p2: b })
    }
  }
  return walls
}

/** Map each TRiK Boog to one or more native curved walls (rational quadratic). */
export function parseCurvedBoogWalls(scope: Element, floorId: string): Wall[] {
  const walls: Wall[] = []
  for (const arc of Array.from(scope.querySelectorAll('GrondplanElementen > Boog'))) {
    const attrs = readBoogAttributes(arc)
    if (!attrs) continue
    const segments = buildArcRationalQuadraticSegments(
      attrs.p1,
      attrs.p2,
      attrs.radius,
      attrs.mirrored,
      attrs.largeArc,
    )
    for (const segment of segments) {
      walls.push({
        id: generateId(),
        floorId,
        points: [scaledPoint(segment.start), scaledPoint(segment.control), scaledPoint(segment.end)],
        curve: { kind: 'rationalQuadratic', weight: segment.weight },
      })
    }
  }
  return walls
}



export function mergeWallsByOverlappingEndpoints(sourceWalls: TrikWallSource[], floorId: string): Wall[] {
  if (sourceWalls.length === 0) return []
  const EPS = 1e-3
  const keyOf = (point: TrikPoint): string => `${Math.round(point.x / EPS)}:${Math.round(point.y / EPS)}`
  const nodeByKey = new Map<string, { id: number; point: TrikPoint }>()
  const pointsByNodeId: TrikPoint[] = []
  const getNode = (point: TrikPoint): number => {
    const key = keyOf(point)
    const existing = nodeByKey.get(key)
    if (existing) return existing.id
    const id = nodeByKey.size
    nodeByKey.set(key, { id, point })
    pointsByNodeId[id] = point
    return id
  }
  const edges = sourceWalls.map((wall, index) => ({
    id: index,
    a: getNode(wall.p1),
    b: getNode(wall.p2),
    used: false,
  }))
  const adjacency = new Map<number, number[]>()
  for (const edge of edges) {
    adjacency.set(edge.a, [...(adjacency.get(edge.a) ?? []), edge.id])
    adjacency.set(edge.b, [...(adjacency.get(edge.b) ?? []), edge.id])
  }
  const pointOf = (nodeId: number): TrikPoint => pointsByNodeId[nodeId] ?? { x: 0, y: 0 }
  const buildPath = (startNode: number, firstEdgeId: number): TrikPoint[] => {
    const path: TrikPoint[] = [pointOf(startNode)]
    let currentNode = startNode
    let edgeId = firstEdgeId
    for (;;) {
      const edge = edges[edgeId]
      if (!edge || edge.used) break
      edge.used = true
      currentNode = edge.a === currentNode ? edge.b : edge.a
      path.push(pointOf(currentNode))
      if (currentNode === startNode) break
      const nodeDegree = (adjacency.get(currentNode) ?? []).length
      const unusedNext = (adjacency.get(currentNode) ?? []).filter((id) => !edges[id]?.used)
      if (nodeDegree !== 2 || unusedNext.length !== 1) break
      edgeId = unusedNext[0] as number
    }
    return path
  }
  const wallPaths: TrikPoint[][] = []
  // Prefer tracing from endpoints / branch points, then fill remaining cycles.
  for (const [nodeId, incident] of adjacency.entries()) {
    if (incident.length === 2) continue
    for (const edgeId of incident) {
      if (edges[edgeId]?.used) continue
      wallPaths.push(buildPath(nodeId, edgeId))
    }
  }
  for (const edge of edges) {
    if (edge.used) continue
    wallPaths.push(buildPath(edge.a, edge.id))
  }
  const toScaled = (points: TrikPoint[]): { x: number; y: number }[] => {
    const out: { x: number; y: number }[] = []
    for (const point of points) {
      const scaled = scaledPoint(point)
      const prev = out[out.length - 1]
      if (!prev || !pointsEqual({ x: prev.x, y: prev.y }, scaled, 1e-6)) out.push(scaled)
    }
    return out
  }
  return wallPaths
    .map((path) => ({
      id: generateId(),
      floorId,
      points: toScaled(path),
    }))
    .filter((wall) => wall.points.length >= 2)
}

export function projectPointOnSegment(point: TrikPoint, a: TrikPoint, b: TrikPoint): { t: number; d: number } {
  const abx = b.x - a.x
  const aby = b.y - a.y
  const apx = point.x - a.x
  const apy = point.y - a.y
  const abLenSq = abx * abx + aby * aby
  if (abLenSq === 0) return { t: 0, d: distance(point, a) }
  const tRaw = (apx * abx + apy * aby) / abLenSq
  const t = clamp(tRaw, 0, 1)
  const proj = { x: a.x + abx * t, y: a.y + aby * t }
  return { t, d: distance(point, proj) }
}

export function getOpeningAnchor(p1: TrikPoint, p2: TrikPoint): TrikPoint {
  return { x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 }
}

/** Max distance (plan units) from opening center to wall segment to count as "on wall". */
export const OPENING_ON_WALL_MAX_DISTANCE = 8

export type OpeningWallPlacement = {
  wallId: string
  position: number
  segmentIndex: number
  centerAlongSegment: number
}

export function openingTouchesWallSegment(
  center: TrikPoint,
  segment: WallSegmentInfo,
  maxDistance: number,
): boolean {
  const projected = projectPointOnSegment(center, segment.p1, segment.p2)
  if (projected.d > maxDistance) return false
  const endpointMargin = 1e-3
  if (projected.t <= endpointMargin || projected.t >= 1 - endpointMargin) {
    const atStart = distance(center, segment.p1) <= maxDistance
    const atEnd = distance(center, segment.p2) <= maxDistance
    if (!atStart && !atEnd) return false
  }
  return true
}

export function createOpeningHostWall(
  p1Scaled: TrikPoint,
  p2Scaled: TrikPoint,
  floorId: string,
  walls: Wall[],
): Wall {
  const wall: Wall = {
    id: generateId(),
    floorId,
    points: [p1Scaled, p2Scaled],
  }
  walls.push(wall)
  return wall
}

export function placeOpeningOnWalls(
  p1Scaled: TrikPoint,
  p2Scaled: TrikPoint,
  walls: Wall[],
  floorId: string,
): OpeningWallPlacement | null {
  const center = getOpeningAnchor(p1Scaled, p2Scaled)
  const wallSegments = buildWallSegments(walls)
  let best: (WallSegmentInfo & { t: number; d: number }) | null = null
  for (const segment of wallSegments) {
    if (!openingTouchesWallSegment(center, segment, OPENING_ON_WALL_MAX_DISTANCE)) continue
    const projected = projectPointOnSegment(center, segment.p1, segment.p2)
    if (!best || projected.d < best.d) {
      best = { ...segment, t: projected.t, d: projected.d }
    }
  }
  if (best) {
    const centerAlongSegment = best.segmentLength * best.t
    const position = (best.startLength + centerAlongSegment) / best.totalWallLength
    return {
      wallId: best.wallId,
      position,
      segmentIndex: best.segmentIndex,
      centerAlongSegment,
    }
  }
  const segmentLength = distance(p1Scaled, p2Scaled)
  if (segmentLength < 1e-6) return null
  const hostWall = createOpeningHostWall(p1Scaled, p2Scaled, floorId, walls)
  return {
    wallId: hostWall.id,
    position: 0.5,
    segmentIndex: 0,
    centerAlongSegment: segmentLength / 2,
  }
}

export function parseTrikDoorOrientation(
  typeRaw: string | null | undefined,
  mirrored: boolean,
): { swing: Door['swing']; direction?: Door['direction'] } {
  const type = (typeRaw ?? '').trim().toLowerCase()
  let swing: Door['swing'] = 'left'
  if (
    type.includes('rechts')
    || type.includes('right')
    || type.includes('clockwise')
    || type.includes('cw')
  ) {
    swing = 'right'
  } else if (
    type.includes('links')
    || type.includes('left')
    || type.includes('counterclockwise')
    || type.includes('ccw')
  ) {
    swing = 'left'
  }
  if (mirrored) swing = swing === 'right' ? 'left' : 'right'

  let direction: Door['direction'] | undefined
  if (
    type.includes('naarbinnen')
    || type.includes('binnen')
    || type.includes('inward')
    || type.includes('inside')
  ) {
    direction = 'in'
  } else if (
    type.includes('naarbuiten')
    || type.includes('buiten')
    || type.includes('outward')
    || type.includes('outside')
  ) {
    direction = 'out'
  } else {
    // Heuristic fallback: mirrored TRiK door often indicates opposite opening direction.
    direction = mirrored ? 'out' : 'in'
  }
  return { swing, direction }
}

export type WallSegmentInfo = {
  p1: TrikPoint
  p2: TrikPoint
  wallId: string
  segmentIndex: number
  segmentLength: number
  startLength: number
  totalWallLength: number
}

export function buildWallSegments(walls: Wall[]): WallSegmentInfo[] {
  const segments: WallSegmentInfo[] = []
  for (const wall of walls) {
    let totalWallLength = 0
    const lengths: number[] = []
    for (let i = 0; i < wall.points.length - 1; i += 1) {
      const p1 = wall.points[i]
      const p2 = wall.points[i + 1]
      if (!p1 || !p2) {
        lengths.push(0)
        continue
      }
      const length = distance(p1, p2)
      lengths.push(length)
      totalWallLength += length
    }
    let cumulative = 0
    for (let i = 0; i < wall.points.length - 1; i += 1) {
      const p1 = wall.points[i]
      const p2 = wall.points[i + 1]
      const segmentLength = lengths[i] ?? 0
      if (!p1 || !p2 || segmentLength <= 0) {
        cumulative += segmentLength
        continue
      }
      segments.push({
        p1,
        p2,
        wallId: wall.id,
        segmentIndex: i,
        segmentLength,
        startLength: cumulative,
        totalWallLength: Math.max(totalWallLength, segmentLength),
      })
      cumulative += segmentLength
    }
  }
  return segments
}

export function parseOpenings<T extends 'Deur' | 'Raam'>(
  scope: Element,
  tag: T,
  floorId: string,
  walls: Wall[],
): T extends 'Deur' ? Door[] : Window[] {
  const results: Array<Door | Window> = []
  for (const opening of Array.from(scope.querySelectorAll(`GrondplanElementen > ${tag}`))) {
    const p1 = parsePoint(opening.querySelector(':scope > P1'))
    const p2 = parsePoint(opening.querySelector(':scope > P2'))
    if (!p1 || !p2) continue

    const p1Scaled = scaledPoint(p1)
    const p2Scaled = scaledPoint(p2)
    const placement = placeOpeningOnWalls(p1Scaled, p2Scaled, walls, floorId)
    if (!placement) continue

    const width = distance(p1, p2) * TRIK_TO_PLAN_SCALE
    if (tag === 'Deur') {
      const mirrored = opening.getAttribute('Gespiegeld')?.toLowerCase() === 'ja'
      const orientation = parseTrikDoorOrientation(opening.getAttribute('Type'), mirrored)
      results.push({
        id: generateId(),
        floorId,
        wallId: placement.wallId,
        position: placement.position,
        segmentIndex: placement.segmentIndex,
        centerAlongSegment: placement.centerAlongSegment,
        width,
        swing: orientation.swing,
        direction: orientation.direction,
      })
      continue
    }
    results.push({
      id: generateId(),
      floorId,
      wallId: placement.wallId,
      position: placement.position,
      segmentIndex: placement.segmentIndex,
      centerAlongSegment: placement.centerAlongSegment,
      width,
    })
  }
  return results as T extends 'Deur' ? Door[] : Window[]
}

export function parseGarageDoors(scope: Element, floorId: string, walls: Wall[]): Door[] {
  const results: Door[] = []
  for (const opening of Array.from(scope.querySelectorAll('GrondplanElementen > Garagepoort'))) {
    const p1 = parsePoint(opening.querySelector(':scope > P1'))
    const p2 = parsePoint(opening.querySelector(':scope > P2'))
    if (!p1 || !p2) continue
    const p1Scaled = scaledPoint(p1)
    const p2Scaled = scaledPoint(p2)
    const placement = placeOpeningOnWalls(p1Scaled, p2Scaled, walls, floorId)
    if (!placement) continue
    results.push({
      id: generateId(),
      floorId,
      wallId: placement.wallId,
      position: placement.position,
      segmentIndex: placement.segmentIndex,
      centerAlongSegment: placement.centerAlongSegment,
      width: distance(p1, p2) * TRIK_TO_PLAN_SCALE,
      swing: 'none',
    })
  }
  return results
}

export function parseStairs(scope: Element, floorId: string): Stair[] {
  const stairs: Stair[] = []
  for (const stair of Array.from(scope.querySelectorAll('GrondplanElementen > Trap'))) {
    const p1 = parsePoint(stair.querySelector(':scope > P1'))
    const p2 = parsePoint(stair.querySelector(':scope > P2'))
    if (!p1 || !p2) continue
    const width = parseNumber(stair.getAttribute('Breedte')) ?? 900
    stairs.push({
      id: generateId(),
      floorId,
      points: [scaledPoint(p1), scaledPoint(p2)],
      width: width * TRIK_TO_PLAN_SCALE,
      stepDepth: 25,
      cornerStyle: 'sharp',
      cornerMode: 'turn',
      showUpArrow: true,
    })
  }
  for (const spiral of Array.from(scope.querySelectorAll('GrondplanElementen > Draaitrap'))) {
    const p1 = parsePoint(spiral.querySelector(':scope > P1'))
    const p2 = parsePoint(spiral.querySelector(':scope > P2'))
    if (!p1 || !p2) continue
    const radius = Math.max(40, distance(p1, p2) * TRIK_TO_PLAN_SCALE)
    const poleDiameter = Math.max(10, radius * 0.2)
    // StairRenderer computes outer radius as (width + poleDiameter) / 2.
    // Use TRiK P1->P2 as the target outer radius and back-calculate width.
    const width = Math.max(8, radius * 2 - poleDiameter)
    stairs.push({
      id: generateId(),
      floorId,
      // Spiral stairs are represented by a single center point in this app.
      points: [scaledPoint(p1)],
      width,
      stepDepth: 18,
      spiralPoleDiameter: poleDiameter,
      cornerStyle: 'round',
      cornerMode: 'turn',
      showUpArrow: true,
    })
  }
  return stairs
}

export function buildFloorPlan(
  scope: Element,
  floorId: string,
  boogMode: TrikBoogImportMode = TRIK_BOOG_IMPORT_MODE,
): FloorPlan | undefined {
  const sourceWalls = parseSourceWalls(scope, boogMode)
  const walls = [
    ...mergeWallsByOverlappingEndpoints(sourceWalls, floorId),
    ...(boogMode === 'curved' ? parseCurvedBoogWalls(scope, floorId) : []),
  ]
  const doors = [
    ...parseOpenings(scope, 'Deur', floorId, walls),
    ...parseGarageDoors(scope, floorId, walls),
  ]
  const windows = parseOpenings(scope, 'Raam', floorId, walls)
  const stairs = parseStairs(scope, floorId)
  if (walls.length === 0 && doors.length === 0 && windows.length === 0 && stairs.length === 0) return undefined
  return {
    walls,
    doors,
    windows,
    stairs,
    masterWallThickness: 20,
  }
}
