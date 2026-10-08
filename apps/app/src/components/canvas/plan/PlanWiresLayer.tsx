import React, { useEffect, useMemo, useRef, useState } from 'react'
import { isKeyboardTypingTarget } from '@/lib/ui/keyboardTypingTarget'
import { Circle, Group, Line, Path, Text } from 'react-konva'
import type { KonvaEventObject } from 'konva/lib/Node'
import type {
  Endpoint,
  Placement,
  PlanWireRoute,
  PlanWireRouteStyle,
  Point2,
  TrunkDevice,
} from '@/types/schema'
import { applyWireInset } from '@/lib/layout/wireInsets'
import { planWireFocusOpacity } from '@/lib/plan/planWiringFocus'
import {
  PLAN_WIRE_ACTIVE_OPACITY,
  PLAN_WIRE_SELECTED_STROKE,
  PLAN_WIRE_STATIC_HOVER_OPACITY,
  PLAN_WIRE_STATIC_OPACITY,
  planWireActiveStroke,
  planWireSpanSetKey,
  planWireStaticStroke,
} from '@/lib/plan/planWiring'
import type { ThemeMode } from '@/lib/theme/types'
import { resolveOrthogonalPolylines, type RoutePointContext } from '@/lib/plan/planWireOrthogonal'
import { distanceSq, projectPointToSegment } from '@/lib/geometry'
import {
  fanOutBundlePolyline,
  planWireBundleKey,
  planWireBundleOffsets,
  planWireBundleLanes,
  planWireBundleLabel,
} from '@/lib/plan/planWireParallel'
import { planWireRiserPassageKey as riserPassageKey } from '@/lib/plan/planWiringRouteEdits'
import { planWireVisualMetrics } from '@/lib/plan/planWireVisualMetrics'

/** A wire end placed through its own placement (junction panel, earth electrode, enclosure). */
export type PlanWireEndPlacement = Placement & { nodeType?: string }
import {
  vectorLength,
  scaledVector,
  unitVector,
  splinePath,
  sampleSpline,
  flatten,
} from '@/lib/plan/planWireGeometry'

interface PlanWiresLayerProps {
  routes: PlanWireRoute[]
  routeStyle: PlanWireRouteStyle
  theme: ThemeMode
  getEndpointById: (id: string) => Endpoint | undefined
  getTrunkDeviceById?: (id: string) => TrunkDevice | undefined
  placementPositionOverrides?: Map<string, Point2>
  /** Junction panel placements by id: they belong to the installation, not to a device. */
  junctionPanelPlacements?: ReadonlyMap<string, PlanWireEndPlacement>
  active: boolean
  /** Map viewport client coords to plan space (accounts for pan/zoom on the content layer). */
  clientToPlan: (clientX: number, clientY: number) => Point2 | null
  /** Plan zoom, so wires keep a minimum on-screen thickness. */
  zoom?: number
  /** Calibrated canvas units per metre, shared by wire decorations and symbols. */
  pxPerMeter?: number | null
  onInsertWaypoint?: (route: PlanWireRoute, point: Point2, waypointIndex: number) => void
  onMoveWaypoint?: (route: PlanWireRoute, waypointIndex: number, point: Point2) => void
  onRemoveWaypoint?: (route: PlanWireRoute, waypointIndex: number) => void
  /** Routes drawn in the selection colour (e.g. the cable selected elsewhere). */
  highlightedRouteIds?: ReadonlySet<string>
  /** Routes hovered elsewhere (e.g. in the cable list): the selection colour, thinner. */
  hoveredRouteIds?: ReadonlySet<string>
  /** Moves the riser a trace arriving from another floor starts at. */
  onMoveRiser?: (route: PlanWireRoute, point: Point2) => void
  /** Per-route colour (e.g. by circuit group in wire mode); falls back to the static colour. */
  routeStrokeFor?: (route: PlanWireRoute) => string | undefined
  /**
   * Routes whose floor-passage handle is drawn by a second, raised instance above the plan
   * symbols (the selected cable), so dragging it wins over rewiring from the symbol below.
   */
  raisedRiserRouteIds?: ReadonlySet<string>
  /** The raised instance: only floor-passage drag handles, no wires. */
  riserHandlesOnly?: boolean
  /** Floor-passage drag preview, shared between the wire layer and the raised handles. */
  riserPreview?: PlanWireRiserPreview | null
  onRiserPreviewChange?: (preview: PlanWireRiserPreview | null) => void
  /** Floor passages selected with a drag rectangle; dragging one of them moves them all. */
  selectedRiserRouteIds?: ReadonlySet<string>
  onMoveRisers?: (moves: Array<{ route: PlanWireRoute; point: Point2 }>) => void
  /** Wire mode: wires fade back only once a branch is focused. */
  focusMode?: boolean
  /** Wire mode's focus branch and its feed to the board, drawn in full. */
  focusRouteIds?: ReadonlySet<string> | null
  /** A branch previewed by hovering, a little brighter than the faded ones. */
  previewRouteIds?: ReadonlySet<string> | null
  /** The wire under the pointer, so the canvas can preview its circuit. */
  onHoverRoute?: (route: PlanWireRoute | null) => void
}

function resolveEndpointAnchor(
  routeEnd: PlanWireRoute['from'],
  floorId: string,
  getEndpointById: (id: string) => Endpoint | undefined,
  getTrunkDeviceById?: (id: string) => TrunkDevice | undefined,
  placementPositionOverrides?: Map<string, Point2>,
  junctionPanelPlacements?: ReadonlyMap<string, PlanWireEndPlacement>
): { point: Point2; nodeType: string; symbolId: string | undefined } | null {
  const endpoint = getEndpointById(routeEnd.endpointId)
  const trunkDevice = routeEnd.trunkDeviceId
    ? getTrunkDeviceById?.(routeEnd.trunkDeviceId)
    : undefined
  const placement =
    endpoint?.placements.find((candidate) => candidate.id === routeEnd.placementId) ??
    endpoint?.placements.find((candidate) => candidate.floorId === floorId) ??
    trunkDevice?.placements?.find((candidate) => candidate.id === routeEnd.placementId) ??
    trunkDevice?.placements?.find((candidate) => candidate.floorId === floorId)
  if (!placement) {
    // Junction panels, earth electrodes and supply enclosures: their own plan placement.
    const panelPlacement = routeEnd.placementId
      ? junctionPanelPlacements?.get(routeEnd.placementId)
      : undefined
    if (!panelPlacement || panelPlacement.floorId !== floorId) return null
    const point = placementPositionOverrides?.get(panelPlacement.id) ?? panelPlacement.pos
    const nodeType = panelPlacement.nodeType ?? 'junction_panel'
    return { point, nodeType, symbolId: nodeType }
  }
  const nodeType = endpoint?.type ?? trunkDevice?.type ?? 'endpoint'
  const symbolId = endpoint?.symbol ?? trunkDevice?.symbol
  if (placement?.id) {
    const override = placementPositionOverrides?.get(placement.id)
    if (override) return { point: override, nodeType, symbolId }
  }
  return { point: placement.pos, nodeType, symbolId }
}

function routePoints(start: Point2, waypoints: Point2[] | undefined, end: Point2): Point2[] {
  return [start, ...(waypoints ?? []), end]
}

function averageContinuation(origin: Point2, continuations: Point2[]): Point2 | undefined {
  if (continuations.length === 0) return undefined
  let x = 0
  let y = 0
  let count = 0
  for (const point of continuations) {
    const unit = unitVector({ x: point.x - origin.x, y: point.y - origin.y })
    if (vectorLength(unit) <= 1e-6) continue
    x += unit.x
    y += unit.y
    count += 1
  }
  if (count === 0) return undefined
  const length = Math.max(
    48,
    Math.min(
      160,
      continuations.reduce(
        (sum, point) => sum + Math.hypot(point.x - origin.x, point.y - origin.y),
        0
      ) /
        count /
        2
    )
  )
  const direction = scaledVector({ x, y }, length)
  return { x: origin.x + direction.x, y: origin.y + direction.y }
}

function routeBeforePoint(route: { basePoints: Point2[] }): Point2 | undefined {
  return route.basePoints[route.basePoints.length - 2] ?? route.basePoints[0]
}

function routeAfterPoint(route: { basePoints: Point2[] }): Point2 | undefined {
  return route.basePoints[1] ?? route.basePoints[0]
}

function applyEndpointInsets(
  start: { point: Point2; nodeType: string; symbolId: string | undefined },
  waypoints: Point2[],
  end: { point: Point2; nodeType: string; symbolId: string | undefined }
): { start: Point2; end: Point2 } {
  const startOther = waypoints[0] ?? end.point
  const endOther = waypoints[waypoints.length - 1] ?? start.point
  return {
    start: applyWireInset(start.point, startOther, start.nodeType, start.symbolId),
    end: applyWireInset(end.point, endOther, end.nodeType, end.symbolId),
  }
}

function nearestWaypointInsertion(
  point: Point2,
  points: Point2[]
): { point: Point2; waypointIndex: number } | null {
  if (points.length < 2) return null
  let best: { point: Point2; waypointIndex: number; distance: number } | null = null
  for (let index = 0; index < points.length - 1; index += 1) {
    const a = points[index]!
    const b = points[index + 1]!
    const projected = projectPointToSegment(point, a, b)
    const projectedDistanceSq = distanceSq(point, projected.point)
    if (!best || projectedDistanceSq < best.distance) {
      best = { point: projected.point, waypointIndex: index, distance: projectedDistanceSq }
    }
  }
  return best
}

function nearestVisualInsertion(
  point: Point2,
  visualPoints: Point2[],
  waypointPoints: Point2[]
): { point: Point2; waypointIndex: number } | null {
  const visual = nearestWaypointInsertion(point, visualPoints)
  const waypoint = nearestWaypointInsertion(point, waypointPoints)
  if (!visual || !waypoint) return null
  return { point: visual.point, waypointIndex: waypoint.waypointIndex }
}

/** Left click / touch primary — middle and right are reserved for pan / context menu. */
function isPrimaryMouseEvent(evt: MouseEvent | TouchEvent | PointerEvent): boolean {
  if (evt instanceof MouseEvent || evt instanceof PointerEvent) {
    return evt.button === 0
  }
  return true
}

/** True for desktop right-click / ctrl+click context menu — not touch double-tap synthetic menu. */
function isExplicitWaypointDeleteContextMenu(evt: MouseEvent | TouchEvent | PointerEvent): boolean {
  if (evt instanceof PointerEvent) {
    if (evt.pointerType === 'touch') return false
    return evt.button === 2
  }
  if (evt instanceof MouseEvent) {
    if (evt.button === 2) return true
    return evt.button === 0 && evt.ctrlKey
  }
  return false
}

function eventCanvasPoint(event: KonvaEventObject<MouseEvent | TouchEvent>): Point2 | null {
  const stage = event.target.getStage()
  const pointer = stage?.getPointerPosition()
  if (!stage || !pointer) return null
  const transform = event.target.getAbsoluteTransform().copy().invert()
  return transform.point(pointer)
}

/** Floor passages being dragged, by passage key: one, or every selected passage. */
export type PlanWireRiserPreview = { points: ReadonlyMap<string, Point2> }

type PlacingWaypointSession = {
  route: PlanWireRoute
  waypointIndex: number
}

export function PlanWiresLayer({
  routes,
  routeStyle,
  theme,
  getEndpointById,
  getTrunkDeviceById,
  placementPositionOverrides,
  junctionPanelPlacements,
  active,
  clientToPlan,
  zoom,
  pxPerMeter,
  onInsertWaypoint,
  onMoveWaypoint,
  onRemoveWaypoint,
  highlightedRouteIds,
  hoveredRouteIds,
  onMoveRiser,
  routeStrokeFor,
  raisedRiserRouteIds,
  riserHandlesOnly = false,
  riserPreview: controlledRiserPreview,
  onRiserPreviewChange,
  selectedRiserRouteIds,
  onMoveRisers,
  focusMode = false,
  focusRouteIds,
  previewRouteIds,
  onHoverRoute,
}: PlanWiresLayerProps) {
  const metrics = planWireVisualMetrics(zoom, pxPerMeter)
  const wireWidth = metrics.strokeWidth
  // Grabbable by finger or cursor at any zoom: never narrower than ~14px on screen.
  const hitWidth = metrics.hitStrokeWidth
  const [hoveredRouteId, setHoveredRouteId] = useState<string | null>(null)
  // A waypoint picked with a click: shown in the selection colour, removed with Delete.
  const [selectedWaypoint, setSelectedWaypoint] = useState<{
    route: PlanWireRoute
    waypointIndex: number
  } | null>(null)
  useEffect(() => {
    if (!active || !selectedWaypoint) return
    const clear = () => setSelectedWaypoint(null)
    const onKeyDown = (event: KeyboardEvent) => {
      if (isKeyboardTypingTarget(event.target)) return
      if (event.key === 'Escape') {
        clear()
        return
      }
      if (event.key !== 'Delete' && event.key !== 'Backspace') return
      // Capture phase: the plan's own Delete (removing selected symbols) must not run too.
      event.preventDefault()
      event.stopPropagation()
      onRemoveWaypoint?.(selectedWaypoint.route, selectedWaypoint.waypointIndex)
      clear()
    }
    // Any other press clears the pick; a click on a waypoint picks again right after.
    window.addEventListener('pointerdown', clear, true)
    window.addEventListener('keydown', onKeyDown, true)
    return () => {
      window.removeEventListener('pointerdown', clear, true)
      window.removeEventListener('keydown', onKeyDown, true)
    }
  }, [active, onRemoveWaypoint, selectedWaypoint])
  const [hoverInsertPreview, setHoverInsertPreview] = useState<{
    routeId: string
    point: Point2
  } | null>(null)
  const [dragWaypointPreview, setDragWaypointPreview] = useState<{
    routeId: string
    waypointIndex: number
    point: Point2
  } | null>(null)
  const [placingWaypoint, setPlacingWaypoint] = useState<PlacingWaypointSession | null>(null)
  const [ownRiserPreview, setOwnRiserPreview] = useState<PlanWireRiserPreview | null>(null)
  const riserPreview =
    controlledRiserPreview !== undefined ? controlledRiserPreview : ownRiserPreview
  const setRiserPreview = onRiserPreviewChange ?? setOwnRiserPreview

  // The last pointer position and whether the button is still down. A quick click can release
  // before the placing effect below has attached its listeners; this is tracked from the start.
  const pointerRef = useRef<{ down: boolean; x: number; y: number } | null>(null)
  useEffect(() => {
    const track = (event: PointerEvent) => {
      pointerRef.current = {
        down:
          event.type === 'pointerup' || event.type === 'pointercancel'
            ? false
            : event.buttons !== 0,
        x: event.clientX,
        y: event.clientY,
      }
    }
    window.addEventListener('pointerdown', track, true)
    window.addEventListener('pointermove', track, true)
    window.addEventListener('pointerup', track, true)
    window.addEventListener('pointercancel', track, true)
    return () => {
      window.removeEventListener('pointerdown', track, true)
      window.removeEventListener('pointermove', track, true)
      window.removeEventListener('pointerup', track, true)
      window.removeEventListener('pointercancel', track, true)
    }
  }, [])

  useEffect(() => {
    if (!placingWaypoint) return

    const { route, waypointIndex } = placingWaypoint

    // Released before we were listening: drop the point where the pointer was released.
    const last = pointerRef.current
    if (last && !last.down) {
      setPlacingWaypoint(null)
      setDragWaypointPreview(null)
      const point = clientToPlan(last.x, last.y)
      if (point) onMoveWaypoint?.(route, waypointIndex, point)
      return
    }

    const onPointerMove = (event: PointerEvent) => {
      const point = clientToPlan(event.clientX, event.clientY)
      if (!point) return
      setDragWaypointPreview({
        routeId: route.id,
        waypointIndex,
        point,
      })
    }

    const finishPlacement = (event: PointerEvent) => {
      if (!isPrimaryMouseEvent(event)) return
      // End the session first: a failing store update must not leave the point on the cursor.
      setPlacingWaypoint(null)
      setDragWaypointPreview(null)
      const point = clientToPlan(event.clientX, event.clientY)
      if (point) {
        onMoveWaypoint?.(route, waypointIndex, point)
      }
    }

    window.addEventListener('pointermove', onPointerMove)
    window.addEventListener('pointerup', finishPlacement)
    window.addEventListener('pointercancel', finishPlacement)
    return () => {
      window.removeEventListener('pointermove', onPointerMove)
      window.removeEventListener('pointerup', finishPlacement)
      window.removeEventListener('pointercancel', finishPlacement)
    }
  }, [clientToPlan, placingWaypoint, onMoveWaypoint])

  const staticStroke = planWireStaticStroke(theme)
  const activeStroke = planWireActiveStroke(theme)
  const waypointRadius = metrics.waypointRadius
  const previewRadius = metrics.previewRadius

  const drawableRoutes = useMemo(() => {
    const drafts = routes
      .map((route) => {
        const startAnchor = resolveEndpointAnchor(
          route.from,
          route.floorId,
          getEndpointById,
          getTrunkDeviceById,
          placementPositionOverrides,
          junctionPanelPlacements
        )
        const passage = riserPassageKey(route)
        const previewRiser = passage !== undefined ? riserPreview?.points.get(passage) : undefined
        if (route.riserExit) {
          // The departure side of a floor passage: a straight run from the symbol to the riser.
          if (!startAnchor) return null
          const riser = previewRiser ?? route.riserExit.pos ?? startAnchor.point
          const start = applyWireInset(
            startAnchor.point,
            riser,
            startAnchor.nodeType,
            startAnchor.symbolId
          )
          return { route, basePoints: [start, riser], style: 'spline' as const }
        }
        const endAnchor = resolveEndpointAnchor(
          route.to,
          route.floorId,
          getEndpointById,
          getTrunkDeviceById,
          placementPositionOverrides,
          junctionPanelPlacements
        )
        if (!startAnchor || !endAnchor) return null
        const style = routeStyle
        const waypoints = [...(route.waypoints ?? [])]
        if (dragWaypointPreview?.routeId === route.id) {
          waypoints[dragWaypointPreview.waypointIndex] = dragWaypointPreview.point
        }
        const insets = applyEndpointInsets(startAnchor, waypoints, endAnchor)
        // A trace arriving from another floor starts at its riser, not at a symbol edge.
        const start = route.riser
          ? (previewRiser ?? route.riser.pos ?? startAnchor.point)
          : insets.start
        const basePoints = routePoints(start, waypoints, insets.end)
        return { route, basePoints, style }
      })
      .filter((entry): entry is NonNullable<typeof entry> => Boolean(entry))

    const incomingByPlacement = new Map<string, typeof drafts>()
    const outgoingByPlacement = new Map<string, typeof drafts>()
    for (const draft of drafts) {
      const toPlacementId = draft.route.to.placementId
      // Departure runs end at a riser, not a symbol: they do not shape neighbouring curves.
      const fromPlacementId = draft.route.riserExit ? undefined : draft.route.from.placementId
      if (toPlacementId) {
        incomingByPlacement.set(toPlacementId, [
          ...(incomingByPlacement.get(toPlacementId) ?? []),
          draft,
        ])
      }
      if (fromPlacementId) {
        outgoingByPlacement.set(fromPlacementId, [
          ...(outgoingByPlacement.get(fromPlacementId) ?? []),
          draft,
        ])
      }
    }

    const incomingRouteIdByRouteId = new Map<string, string>()
    const outgoingRouteIdByRouteId = new Map<string, string>()

    const draftContexts = drafts.map((draft) => {
      const incoming = draft.route.from.placementId
        ? (incomingByPlacement.get(draft.route.from.placementId) ?? [])
        : []
      const outgoing = draft.route.to.placementId
        ? (outgoingByPlacement.get(draft.route.to.placementId) ?? [])
        : []
      const incomingRoute = incoming.find((route) => route.route.id !== draft.route.id)
      const outgoingRoute =
        outgoing.length === 1
          ? outgoing.find((route) => route.route.id !== draft.route.id)
          : undefined
      if (incomingRoute) incomingRouteIdByRouteId.set(draft.route.id, incomingRoute.route.id)
      if (outgoingRoute) outgoingRouteIdByRouteId.set(draft.route.id, outgoingRoute.route.id)
      const context: RoutePointContext = {}
      if (incomingRoute) {
        context.startPrevious = routeBeforePoint(incomingRoute)
      }
      if (outgoingRoute) {
        context.endNext = routeAfterPoint(outgoingRoute)
      } else if (outgoing.length > 1) {
        const forkPoint = draft.basePoints[draft.basePoints.length - 1]
        if (forkPoint) {
          context.endNext = averageContinuation(
            forkPoint,
            outgoing
              .filter((route) => route.route.id !== draft.route.id)
              .map(routeAfterPoint)
              .filter((point): point is Point2 => Boolean(point))
          )
        }
      }
      return { draft, context }
    })

    const orthogonalInputs = draftContexts
      .filter(({ draft }) => draft.style === 'orthogonal')
      .map(({ draft, context }) => ({
        id: draft.route.id,
        spanSetKey: planWireSpanSetKey(draft.route),
        basePoints: draft.basePoints,
        context: context.startPrevious || context.endNext ? context : undefined,
      }))

    const orthogonalPolylines = resolveOrthogonalPolylines(orthogonalInputs, {
      getIncomingRouteId: (routeId) => incomingRouteIdByRouteId.get(routeId),
      getOutgoingRouteId: (routeId) => outgoingRouteIdByRouteId.get(routeId),
    })

    // Cables between the same two symbols along the same path share one curve and are drawn
    // side by side, evenly spaced, instead of on top of each other.
    const lineOf = (index: number): Point2[] => {
      const { draft, context } = draftContexts[index]!
      const hasContext = Boolean(context.startPrevious || context.endNext)
      return draft.style === 'spline'
        ? sampleSpline(draft.basePoints, hasContext ? context : undefined)
        : draft.style === 'straight'
          ? draft.basePoints
          : (orthogonalPolylines.get(draft.route.id) ?? draft.basePoints)
    }
    const bundles = new Map<string, Array<{ index: number; reversed: boolean }>>()
    draftContexts.forEach(({ draft }, index) => {
      const bundle = planWireBundleKey(draft.route, draft.basePoints)
      if (!bundle) return
      bundles.set(bundle.key, [
        ...(bundles.get(bundle.key) ?? []),
        { index, reversed: bundle.reversed },
      ])
    })
    const bundledPoints = new Map<number, Point2[]>()
    const bundlePresentation = new Map<
      number,
      {
        visible: boolean
        count?: number
        dashSlot: number
        dashSlots: number
        labelFraction: number
      }
    >()
    for (const members of bundles.values()) {
      if (members.length < 2) continue
      const sorted = [...members].sort((a, b) =>
        draftContexts[a.index]!.draft.route.id.localeCompare(draftContexts[b.index]!.draft.route.id)
      )
      const leader = sorted[0]!
      const leaderLine = lineOf(leader.index)
      const centre = leader.reversed ? [...leaderLine].reverse() : leaderLine
      const lanes = planWireBundleLanes(
        sorted.map((member) => {
          const route = draftContexts[member.index]!.draft.route
          return {
            index: member.index,
            color: routeStrokeFor?.(route) ?? staticStroke,
            priority: highlightedRouteIds?.has(route.id)
              ? 2
              : hoveredRouteIds?.has(route.id) || hoveredRouteId === route.id
                ? 1
                : 0,
          }
        })
      )
      const offsets = planWireBundleOffsets(
        Math.max(...lanes.map((lane) => lane.lane)) + 1,
        metrics.parallelSpacing
      )
      lanes.forEach((lane) => {
        for (const index of lane.indices) {
          const member = members.find((candidate) => candidate.index === index)!
          const shifted = fanOutBundlePolyline(centre, offsets[lane.lane]!)
          bundledPoints.set(index, member.reversed ? shifted.reverse() : shifted)
          bundlePresentation.set(index, {
            visible: index === lane.representative,
            count: lane.count,
            dashSlot: lane.dashSlot,
            dashSlots: lane.dashSlots,
            labelFraction: member.reversed ? 0.65 - lane.lane * 0.1 : 0.35 + lane.lane * 0.1,
          })
        }
      })
    }

    return draftContexts.map(({ draft, context }, index) => {
      const hasContext = Boolean(context.startPrevious || context.endNext)
      const bundled = bundledPoints.get(index)
      const points =
        bundled ??
        (draft.style === 'spline' || draft.style === 'straight'
          ? draft.basePoints
          : (orthogonalPolylines.get(draft.route.id) ?? draft.basePoints))
      const hitPoints =
        bundled ??
        (draft.style === 'spline'
          ? sampleSpline(draft.basePoints, hasContext ? context : undefined)
          : points)
      const pathData =
        !bundled && draft.style === 'spline'
          ? splinePath(draft.basePoints, hasContext ? context : undefined)
          : ''
      return {
        route: draft.route,
        points,
        basePoints: draft.basePoints,
        // A bundled wire is drawn as its offset polyline.
        style: bundled ? ('orthogonal' as const) : draft.style,
        hitPoints,
        pathData,
        bundle: bundlePresentation.get(index),
      }
    })
  }, [
    dragWaypointPreview,
    riserPreview,
    getEndpointById,
    getTrunkDeviceById,
    placementPositionOverrides,
    junctionPanelPlacements,
    routeStyle,
    routes,
    routeStrokeFor,
    staticStroke,
    highlightedRouteIds,
    hoveredRouteIds,
    hoveredRouteId,
    metrics.parallelSpacing,
  ])

  const riserPointOf = (route: PlanWireRoute, basePoints: Point2[]) =>
    route.riser ? basePoints[0] : route.riserExit ? basePoints[basePoints.length - 1] : undefined

  /** The passages a drag moves: every selected one when the dragged one is selected. */
  const dragGroup = (route: PlanWireRoute) => {
    const own = drawableRoutes.find((entry) => entry.route.id === route.id)
    const origin = own ? riserPointOf(own.route, own.basePoints) : undefined
    if (!origin) return []
    if (!selectedRiserRouteIds?.has(route.id)) return [{ route, origin }]
    return drawableRoutes.flatMap((entry) => {
      if (!selectedRiserRouteIds.has(entry.route.id)) return []
      const point = riserPointOf(entry.route, entry.basePoints)
      return point ? [{ route: entry.route, origin: point }] : []
    })
  }
  // Taken when a drag starts: the preview moves the passages while dragging.
  const dragGroupRef = useRef<ReturnType<typeof dragGroup> | null>(null)
  const movedGroup = (route: PlanWireRoute, to: Point2) => {
    const group = dragGroupRef.current ?? dragGroup(route)
    const own = group.find((member) => member.route.id === route.id)
    if (!own) return []
    const dx = to.x - own.origin.x
    const dy = to.y - own.origin.y
    return group.map((member) => ({
      route: member.route,
      point: { x: member.origin.x + dx, y: member.origin.y + dy },
    }))
  }

  function riserHandle(route: PlanWireRoute, riserPoint: Point2) {
    if (!active || !onMoveRiser) return null
    return (
      <Circle
        key={`riser-handle-${route.id}`}
        x={riserPoint.x}
        y={riserPoint.y}
        radius={waypointRadius * 1.8}
        fill="rgba(0,0,0,0.001)"
        draggable
        onMouseDown={(event) => {
          event.cancelBubble = true
          if (!isPrimaryMouseEvent(event.evt)) event.target.stopDrag()
        }}
        onPointerDown={(event) => {
          // Keep the symbol underneath from starting a rewire.
          event.cancelBubble = true
        }}
        onDragStart={() => {
          dragGroupRef.current = dragGroup(route)
        }}
        onDragMove={(event) => {
          const moves = movedGroup(route, { x: event.target.x(), y: event.target.y() })
          setRiserPreview({
            points: new Map(
              moves.map((move) => [riserPassageKey(move.route) ?? move.route.id, move.point])
            ),
          })
        }}
        onDragEnd={(event) => {
          setRiserPreview(null)
          const moves = movedGroup(route, { x: event.target.x(), y: event.target.y() })
          dragGroupRef.current = null
          if (moves.length > 1 && onMoveRisers) onMoveRisers(moves)
          else onMoveRiser(route, { x: event.target.x(), y: event.target.y() })
        }}
      />
    )
  }

  if (riserHandlesOnly) {
    return (
      <Group name="plan-wire-riser-handles" listening={active}>
        {drawableRoutes.map(({ route, basePoints }) => {
          const riserPoint = riserPointOf(route, basePoints)
          return riserPoint ? riserHandle(route, riserPoint) : null
        })}
      </Group>
    )
  }

  return (
    <Group name="plan-wires-layer" listening={active}>
      {drawableRoutes.map(({ route, points, basePoints, style, hitPoints, pathData, bundle }) => {
        if (bundle?.visible === false) return null
        const hovered = hoveredRouteId === route.id
        const highlighted = highlightedRouteIds?.has(route.id) === true
        const hoveredElsewhere = !highlighted && hoveredRouteIds?.has(route.id) === true
        const stroke =
          highlighted || hoveredElsewhere
            ? PLAN_WIRE_SELECTED_STROKE
            : (routeStrokeFor?.(route) ?? staticStroke)
        const strokeWidth = highlighted
          ? wireWidth * 2
          : hoveredElsewhere
            ? wireWidth * 1.5
            : wireWidth
        const riserPoint = riserPointOf(route, basePoints)
        const countPosition = bundle?.count
          ? planWireBundleLabel(points, bundle.labelFraction)
          : undefined
        const countSize = metrics.countFontSize
        // More than four colour groups alternate dashes in the same four lanes.
        const dash =
          bundle && bundle.dashSlots > 1
            ? [6 * metrics.decorationScale, (bundle.dashSlots * 11 - 6) * metrics.decorationScale]
            : metrics.dash
        const dashOffset = bundle ? -bundle.dashSlot * 11 * metrics.decorationScale : 0
        const passageSelected = selectedRiserRouteIds?.has(route.id) === true
        const focusOpacity = planWireFocusOpacity(
          route,
          focusMode,
          focusRouteIds,
          previewRouteIds
        )
        const opacity =
          highlighted || hoveredElsewhere
            ? PLAN_WIRE_ACTIVE_OPACITY
            : focusOpacity !== undefined
              ? focusOpacity
              : hovered
                ? PLAN_WIRE_STATIC_HOVER_OPACITY
                : PLAN_WIRE_STATIC_OPACITY
        return (
          <React.Fragment key={route.id}>
            {style === 'spline' ? (
              <Path
                data={pathData}
                stroke={stroke}
                strokeWidth={strokeWidth}
                opacity={opacity}
                dash={dash}
                dashOffset={dashOffset}
                lineCap="round"
                lineJoin="round"
                listening={false}
              />
            ) : (
              <Line
                points={flatten(points)}
                stroke={stroke}
                strokeWidth={strokeWidth}
                opacity={opacity}
                dash={dash}
                dashOffset={dashOffset}
                lineCap="round"
                lineJoin="round"
                listening={false}
              />
            )}
            {countPosition && bundle && (
              <Text
                x={countPosition.x + metrics.countOffset}
                y={countPosition.y - countSize * (1 + bundle.dashSlot)}
                text={`×${bundle.count}`}
                fontSize={countSize}
                fontStyle="bold"
                fill={stroke}
                listening={false}
              />
            )}
            <Line
              points={flatten(hitPoints)}
              stroke="rgba(0,0,0,0.001)"
              strokeWidth={1}
              hitStrokeWidth={hitWidth}
              lineCap="round"
              lineJoin="round"
              onMouseEnter={(event) => {
                setHoveredRouteId(route.id)
                onHoverRoute?.(route)
                if (!active || route.riserExit) return
                const point = eventCanvasPoint(event)
                const insertion = point
                  ? nearestVisualInsertion(point, hitPoints, basePoints)
                  : null
                setHoverInsertPreview(
                  insertion ? { routeId: route.id, point: insertion.point } : null
                )
              }}
              onMouseMove={(event) => {
                if (!active || route.riserExit) return
                const point = eventCanvasPoint(event)
                const insertion = point
                  ? nearestVisualInsertion(point, hitPoints, basePoints)
                  : null
                setHoverInsertPreview(
                  insertion ? { routeId: route.id, point: insertion.point } : null
                )
              }}
              onMouseLeave={() => {
                setHoveredRouteId(null)
                onHoverRoute?.(null)
                setHoverInsertPreview(null)
              }}
              onMouseDown={(event) => {
                if (placingWaypoint || !active || !onInsertWaypoint || !onMoveWaypoint) return
                // A departure run is shaped on the arrival floor; here only its riser moves.
                if (route.riserExit) return
                if (!isPrimaryMouseEvent(event.evt)) return
                event.cancelBubble = true
                event.evt.preventDefault()
                const point = eventCanvasPoint(event)
                if (!point) return
                const insertion = nearestVisualInsertion(point, hitPoints, basePoints)
                if (!insertion) return
                const placePoint =
                  clientToPlan(event.evt.clientX, event.evt.clientY) ?? insertion.point
                onInsertWaypoint(route, placePoint, insertion.waypointIndex)
                setDragWaypointPreview({
                  routeId: route.id,
                  waypointIndex: insertion.waypointIndex,
                  point: placePoint,
                })
                setPlacingWaypoint({
                  route,
                  waypointIndex: insertion.waypointIndex,
                })
              }}
            />
            {active &&
              hoverInsertPreview?.routeId === route.id &&
              (!route.waypoints || route.waypoints.length === 0 || hovered) && (
                <Circle
                  x={hoverInsertPreview.point.x}
                  y={hoverInsertPreview.point.y}
                  radius={previewRadius}
                  fill={activeStroke}
                  opacity={0.35}
                  stroke="#ffffff"
                  strokeWidth={wireWidth}
                  listening={false}
                />
              )}
            {active &&
              basePoints.map((point, index) => {
                const waypointIndex = index - 1
                const isWaypoint =
                  waypointIndex >= 0 && waypointIndex < (route.waypoints?.length ?? 0)
                if (!isWaypoint) return null
                const isPlacing =
                  placingWaypoint?.route.id === route.id &&
                  placingWaypoint.waypointIndex === waypointIndex
                const isPicked =
                  selectedWaypoint?.route.id === route.id &&
                  selectedWaypoint.waypointIndex === waypointIndex
                return (
                  <Circle
                    key={`${route.id}-${index}`}
                    x={point.x}
                    y={point.y}
                    radius={isPicked ? waypointRadius * 1.4 : waypointRadius}
                    fill={isPicked ? PLAN_WIRE_SELECTED_STROKE : activeStroke}
                    stroke="#ffffff"
                    strokeWidth={wireWidth}
                    draggable={!isPlacing}
                    listening={!isPlacing}
                    onMouseDown={(event) => {
                      if (!isPrimaryMouseEvent(event.evt)) {
                        event.target.stopDrag()
                      }
                    }}
                    onDragStart={(event) => {
                      if (!isPrimaryMouseEvent(event.evt)) {
                        event.target.stopDrag()
                      }
                    }}
                    onClick={(event) => {
                      event.cancelBubble = true
                      if (event.evt.altKey && onRemoveWaypoint) {
                        onRemoveWaypoint(route, waypointIndex)
                        return
                      }
                      setSelectedWaypoint({ route, waypointIndex })
                    }}
                    onContextMenu={(event) => {
                      event.evt.preventDefault()
                      event.cancelBubble = true
                      if (!isExplicitWaypointDeleteContextMenu(event.evt)) return
                      onRemoveWaypoint?.(route, waypointIndex)
                    }}
                    onDragMove={(event) => {
                      setDragWaypointPreview({
                        routeId: route.id,
                        waypointIndex,
                        point: { x: event.target.x(), y: event.target.y() },
                      })
                    }}
                    onDragEnd={(event) => {
                      setDragWaypointPreview(null)
                      if (!isPrimaryMouseEvent(event.evt) || !onMoveWaypoint) return
                      onMoveWaypoint(route, waypointIndex, {
                        x: event.target.x(),
                        y: event.target.y(),
                      })
                    }}
                  />
                )
              })}
            {riserPoint && (
              <Group>
                <Circle
                  x={riserPoint.x}
                  y={riserPoint.y}
                  radius={waypointRadius * 1.6}
                  stroke={passageSelected ? PLAN_WIRE_SELECTED_STROKE : stroke}
                  strokeWidth={passageSelected ? wireWidth * 2 : strokeWidth}
                  opacity={passageSelected ? PLAN_WIRE_ACTIVE_OPACITY : opacity}
                  listening={false}
                />
                <Circle
                  x={riserPoint.x}
                  y={riserPoint.y}
                  radius={waypointRadius * 0.8}
                  stroke={passageSelected ? PLAN_WIRE_SELECTED_STROKE : stroke}
                  strokeWidth={passageSelected ? wireWidth * 2 : strokeWidth}
                  opacity={passageSelected ? PLAN_WIRE_ACTIVE_OPACITY : opacity}
                  listening={false}
                />
                {!raisedRiserRouteIds?.has(route.id) && riserHandle(route, riserPoint)}
              </Group>
            )}
          </React.Fragment>
        )
      })}
    </Group>
  )
}
