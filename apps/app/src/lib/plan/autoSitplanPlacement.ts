/**
 * Shared auto-layout for sitplan placements (one-wire drop + orphan repair).
 * Keeps one horizontal row per circuit; new circuit rows stack upward.
 * When the plan canvas is visible and the active floor matches, prefers the
 * viewport center (with collision separation from existing symbols).
 */

import type { Point, ViewportLayout } from '@/types/ui'
import type { Placement } from '@/types/schema'
import { collectPlacementsOnFloor, findCircuitForEndpointInProject } from '@/utils/project'
import {
  selectProjectBuildingFloors,
  type ProjectWithOptionalV2Building,
} from '@/lib/projectV2/buildingFloors'
import {
  selectProjectElectricalPanels,
  type ProjectWithOptionalV2Electrical,
} from '@/lib/projectV2/electrical'
import { getAllCircuits } from '@/lib/eendraad/projectElectricalDomain'
import { markAwaitingPlanPlacement } from '@/lib/plan/customPlacement'
import { isManualPlanPlacementEnabled } from '@/lib/plan/manualPlanPlacementPreference'

const ORIGIN_X = 400
const ORIGIN_Y = 300
const COL_SPACING = 80
const ROW_SPACING = 80

/** Plan-space half-extent for collision (covers typical symbol footprint + margin). */
const COLLISION_BASE_HALF = 42

export type AutoSitplanPlacementOpts = {
  circuitId: string
  floorId: string
  placementId: string
  /** Plan-space position to try first (e.g. viewport center); separated from overlaps when set */
  preferredPlanPos?: { x: number; y: number }
  /**
   * Load-time healing creates placements that must stay visible; everything else follows
   * the user's manual plan placement preference.
   */
  ignoreManualPlacementPreference?: boolean
}

type AutoSitplanPlacementProject = ProjectWithOptionalV2Building & ProjectWithOptionalV2Electrical

function squaresOverlap(
  ax: number,
  ay: number,
  aHalf: number,
  bx: number,
  by: number,
  bHalf: number,
): boolean {
  return Math.abs(ax - bx) < aHalf + bHalf && Math.abs(ay - by) < aHalf + bHalf
}

function halfExtentForPlacement(scale: number | undefined): number {
  return COLLISION_BASE_HALF * Math.max(scale ?? 1, 0.25)
}

/**
 * First non-overlapping plan position: try `start`, then an outward spiral in plan space.
 * Falls back to `start` if nothing free within `maxRadius`.
 */
function separatePlanPositionFromPlacements(
  start: Point,
  newHalf: number,
  obstacles: Array<{ x: number; y: number; half: number }>,
  maxRadius = 720,
): Point {
  const hits = (x: number, y: number) =>
    obstacles.some((o) => squaresOverlap(x, y, newHalf, o.x, o.y, o.half))

  if (!hits(start.x, start.y)) return start

  const ringStep = 16
  const anglesPerRing = 20
  const maxRing = Math.ceil(maxRadius / ringStep)

  for (let ring = 1; ring <= maxRing; ring++) {
    const r = ring * ringStep
    for (let i = 0; i < anglesPerRing; i++) {
      const a = (i * 2 * Math.PI) / anglesPerRing
      const x = start.x + Math.cos(a) * r
      const y = start.y + Math.sin(a) * r
      if (!hits(x, y)) return { x, y }
    }
  }

  return start
}

/**
 * Plan-space point at the center of the visible plan canvas, when the layout includes plan,
 * dimensions are known, and the UI active floor is the floor we place on (same as PlanCanvas).
 */
export function getViewportCenterPlanSpaceIfApplicable(
  viewportLayout: ViewportLayout,
  planCanvasViewportPx: { width: number; height: number } | null,
  uiActiveFloorId: string | null,
  targetFloorId: string,
  planView: { zoom: number; pan: Point },
): Point | null {
  if (!viewportLayout.panels.some((p) => p.canvas === 'plan')) return null
  if (!planCanvasViewportPx || planCanvasViewportPx.width < 24 || planCanvasViewportPx.height < 24) {
    return null
  }
  if (uiActiveFloorId !== targetFloorId) return null

  const z = planView.zoom
  if (!Number.isFinite(z) || Math.abs(z) < 1e-6) return null

  const cx = planCanvasViewportPx.width / 2
  const cy = planCanvasViewportPx.height / 2
  return {
    x: (cx - planView.pan.x) / z,
    y: (cy - planView.pan.y) / z,
  }
}

function buildObstaclesForLayer(
  placementsOnFloor: Array<Placement & { endpointId?: string; junctionPanelLabel?: string }>,
  layer: string,
): Array<{ x: number; y: number; half: number }> {
  const out: Array<{ x: number; y: number; half: number }> = []
  for (const pl of placementsOnFloor) {
    if (pl.layer !== layer) continue
    out.push({
      x: pl.pos.x,
      y: pl.pos.y,
      half: halfExtentForPlacement(pl.scale),
    })
  }
  return out
}

export function buildAutoSitplanPlacement(
  project: AutoSitplanPlacementProject,
  opts: AutoSitplanPlacementOpts,
): Placement | null {
  const floor = selectProjectBuildingFloors(project).find((f) => f.id === opts.floorId)
  if (!floor) return null

  const layer = 'layers' in floor && Array.isArray(floor.layers) ? floor.layers[0] ?? 'electrical' : 'electrical'
  const allPlacements = collectPlacementsOnFloor(project, opts.floorId)
  const trunkCircuitIdByDeviceId = new Map<string, string>()
  for (const panel of selectProjectElectricalPanels(project)) {
    for (const circuit of getAllCircuits(panel)) {
      for (const device of circuit.trunkDevices ?? []) {
        trunkCircuitIdByDeviceId.set(device.id, circuit.id)
      }
    }
  }
  const circuitIdForPlacement = (
    placement: Placement & { endpointId?: string; trunkDeviceId?: string },
  ) => {
    if (placement.endpointId) {
      return findCircuitForEndpointInProject(project, placement.endpointId)?.circuit.id
    }
    return placement.trunkDeviceId
      ? trunkCircuitIdByDeviceId.get(placement.trunkDeviceId)
      : undefined
  }

  const placementsForCircuit = allPlacements.filter((pl) => {
    return circuitIdForPlacement(pl) === opts.circuitId
  })

  let posX = ORIGIN_X
  let posY = ORIGIN_Y

  if (placementsForCircuit.length > 0) {
    const baseY = placementsForCircuit[0]!.pos.y
    const maxX = Math.max(...placementsForCircuit.map((pl) => pl.pos.x))
    posX = maxX + COL_SPACING
    posY = baseY
  } else {
    const rowYByCircuit = new Map<string, number>()
    for (const pl of allPlacements) {
      const cid = circuitIdForPlacement(pl)
      if (!cid || rowYByCircuit.has(cid)) continue
      rowYByCircuit.set(cid, pl.pos.y)
    }

    if (rowYByCircuit.size === 0) {
      posX = ORIGIN_X
      posY = ORIGIN_Y
    } else {
      const existingYs = Array.from(rowYByCircuit.values())
      const highestRowY = Math.min(...existingYs)
      posX = ORIGIN_X
      posY = highestRowY - ROW_SPACING
    }
  }

  const legacyPos = { x: posX, y: posY }
  let pos = legacyPos

  if (opts.preferredPlanPos) {
    const newHalf = halfExtentForPlacement(1)
    const obstacles = buildObstaclesForLayer(allPlacements, layer)
    const fromPreferred = separatePlanPositionFromPlacements(opts.preferredPlanPos, newHalf, obstacles)
    const stillOverlaps = obstacles.some((o) =>
      squaresOverlap(fromPreferred.x, fromPreferred.y, newHalf, o.x, o.y, o.half),
    )
    pos = stillOverlaps ? separatePlanPositionFromPlacements(legacyPos, newHalf, obstacles) : fromPreferred
  }

  const placement: Placement = {
    id: opts.placementId,
    floorId: opts.floorId,
    layer,
    pos,
    rotationDeg: 0,
    scale: 1,
  }
  return isManualPlanPlacementEnabled() && !opts.ignoreManualPlacementPreference
    ? markAwaitingPlanPlacement(placement)
    : placement
}
