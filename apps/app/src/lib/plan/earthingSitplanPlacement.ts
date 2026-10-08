import type { EarthingPlacement, Endpoint, Installation, Panel, Placement, Point2 } from '@/types/schema'
import { generateId } from '@/utils/project'
import {
  selectProjectBuildingFloors,
  type ProjectWithOptionalV2Building,
} from '@/lib/projectV2/buildingFloors'
import {
  selectProjectElectricalInstallation,
  selectProjectElectricalPanels,
  type ProjectWithOptionalV2Electrical,
} from '@/lib/projectV2/electrical'
import { findMainPanel } from '@/lib/panel/panelTree'
import { installationHasAnyEarthing } from '@/lib/eendraad/panelGround'

type EarthingSitplanProject = ProjectWithOptionalV2Building & ProjectWithOptionalV2Electrical

const DEFAULT_CENTER_X = 400
const DEFAULT_CENTER_Y = 300
const EARTHING_OFFSET_FROM_PANEL_X = 120

export type SitplanPlacementRow = {
  isEarthing?: boolean
  junctionPanelLabel?: string
  endpointId?: string
}

export function getEarthingPlacements(
  installation: Installation | undefined,
): EarthingPlacement[] {
  return installation?.earthingPlacements ?? []
}

export function findEarthingPlacementOnFloor(
  project: EarthingSitplanProject | null | undefined,
  floorId: string,
): EarthingPlacement | undefined {
  if (!project) return undefined
  return getEarthingPlacements(selectProjectElectricalInstallation(project)).find(
    (p) => p.floorId === floorId
  )
}

function findPanelEndpointInPanels(panels: Panel[], panel: Panel): Endpoint | null {
  for (const current of panels) {
    for (const circuit of current.circuits) {
      const endpoint = circuit.endpoints.find(
        (candidate) =>
          candidate.symbol === 'panel_distribution' &&
          (candidate.panelId === panel.id || candidate.label === panel.name)
      )
      if (endpoint) return endpoint
    }
    for (const protection of current.protections) {
      for (const circuit of protection.circuits ?? []) {
        const endpoint = circuit.endpoints.find(
          (candidate) =>
            candidate.symbol === 'panel_distribution' &&
            (candidate.panelId === panel.id || candidate.label === panel.name)
        )
        if (endpoint) return endpoint
      }
    }
    const inSub = findPanelEndpointInPanels(current.subPanels, panel)
    if (inSub) return inSub
  }
  return null
}

function collectPlacementsOnFloorFromProject(
  project: EarthingSitplanProject,
  floorId: string
): Array<Placement & { endpointId?: string; junctionPanelLabel?: string; isEarthing?: boolean }> {
  const result: Array<
    Placement & { endpointId?: string; junctionPanelLabel?: string; isEarthing?: boolean }
  > = []
  const panels = selectProjectElectricalPanels(project)
  const installation = selectProjectElectricalInstallation(project)

  const visitPanel = (panel: Panel) => {
    const circuits = [
      ...panel.circuits,
      ...panel.protections.flatMap((protection) => protection.circuits ?? []),
    ]
    for (const circuit of circuits) {
      for (const endpoint of circuit.endpoints) {
        for (const placement of endpoint.placements) {
          if (placement.floorId === floorId) {
            result.push({ ...placement, endpointId: endpoint.id })
          }
        }
      }
    }
    for (const subPanel of panel.subPanels) visitPanel(subPanel)
  }

  for (const panel of panels) visitPanel(panel)

  for (const jp of installation?.junctionPanelPlacements ?? []) {
    if (jp.floorId === floorId) {
      result.push({
        id: jp.id,
        floorId: jp.floorId,
        layer: jp.layer ?? 'default',
        pos: jp.pos,
        rotationDeg: (jp.rotationDeg ?? 0) as Placement['rotationDeg'],
        rotationMode: jp.rotationMode,
        scale: jp.scale ?? 1,
        junctionPanelLabel: jp.label,
      })
    }
  }
  for (const ep of installation?.earthingPlacements ?? []) {
    if (ep.floorId === floorId) {
      result.push({
        id: ep.id,
        floorId: ep.floorId,
        layer: ep.layer ?? 'default',
        pos: ep.pos,
        rotationDeg: (ep.rotationDeg ?? 0) as Placement['rotationDeg'],
        rotationMode: ep.rotationMode,
        scale: ep.scale ?? 1,
        locked: ep.locked,
        isEarthing: true,
      })
    }
  }

  return result
}

function firstFloorLayer(floor: ReturnType<typeof selectProjectBuildingFloors>[number] | undefined): string {
  return floor && 'layers' in floor ? floor.layers?.[0] ?? 'electrical' : 'electrical'
}

function resolveEarthingTargetFloor(project: EarthingSitplanProject): {
  floorId: string
  anchorPos?: Point2
} | null {
  const mainPanel = findMainPanel(selectProjectElectricalPanels(project))
  if (!mainPanel) return null

  const panelEndpoint = findPanelEndpointInPanels(selectProjectElectricalPanels(project), mainPanel)
  const panelPlacement = panelEndpoint?.placements[0]
  if (panelPlacement) {
    return { floorId: panelPlacement.floorId, anchorPos: panelPlacement.pos }
  }

  const floors = selectProjectBuildingFloors(project)
  const groundFloor =
    floors.find(
      (f) =>
        f.name.toLowerCase().includes('ground') || f.name.toLowerCase().includes('grond'),
    ) ?? floors[0]
  if (!groundFloor) return null
  return { floorId: groundFloor.id }
}

function defaultEarthingPlanPosition(
  project: EarthingSitplanProject,
  floorId: string,
  anchorPos?: Point2,
): Point2 {
  if (anchorPos) {
    return { x: anchorPos.x + EARTHING_OFFSET_FROM_PANEL_X, y: anchorPos.y }
  }
  const obstacles = collectPlacementsOnFloorFromProject(project, floorId).map((p) => ({
    x: p.pos.x,
    y: p.pos.y,
    half: 42 * Math.max(p.scale ?? 1, 0.25),
  }))
  let pos: Point2 = { x: DEFAULT_CENTER_X, y: DEFAULT_CENTER_Y }
  for (const o of obstacles) {
    if (Math.abs(pos.x - o.x) < 84 && Math.abs(pos.y - o.y) < 84) {
      pos = { x: pos.x + 96, y: pos.y }
    }
  }
  return pos
}

/**
 * Backfill sitplan earthing placements for projects that already have ground on the
 * one-line diagram but were saved before `installation.earthingPlacements` existed.
 * Also repairs placements left pointing at a deleted floor by older editor versions.
 * Mutates the project in place; returns true when a placement was added or repaired.
 */
export function healEarthingSitplanPlacements(project: EarthingSitplanProject): boolean {
  const inst = selectProjectElectricalInstallation(project)
  if (
    !inst ||
    !installationHasAnyEarthing(selectProjectElectricalPanels(project), inst)
  ) {
    return false
  }
  const target = resolveEarthingTargetFloor(project)
  if (!target) return false

  const floors = selectProjectBuildingFloors(project)
  const floor = floors.find((f) => f.id === target.floorId)
  if (!floor) return false

  const validFloorIds = new Set(floors.map((candidate) => candidate.id))
  let repaired = false
  for (const placement of inst.earthingPlacements ?? []) {
    if (!validFloorIds.has(placement.floorId)) {
      placement.floorId = target.floorId
      repaired = true
    }
  }
  if ((inst.earthingPlacements?.length ?? 0) > 0) return repaired

  const placement: EarthingPlacement = {
    id: generateId(),
    floorId: target.floorId,
    pos: defaultEarthingPlanPosition(project, target.floorId, target.anchorPos),
    rotationDeg: 0,
    scale: 1,
    layer: firstFloorLayer(floor),
  }

  if (!inst.earthingPlacements) inst.earthingPlacements = []
  inst.earthingPlacements.push(placement)
  return true
}

/** New earthing placement at its default sitplan position (next to the main panel when placed). */
export function buildDefaultEarthingSitplanPlacement(
  project: EarthingSitplanProject,
  floorId: string,
  pos?: Point2,
): EarthingPlacement {
  const floor = selectProjectBuildingFloors(project).find((f) => f.id === floorId)
  const layer = firstFloorLayer(floor)
  const target = resolveEarthingTargetFloor(project)
  const resolvedPos =
    pos ??
    (target
      ? defaultEarthingPlanPosition(project, target.floorId, target.anchorPos)
      : { x: DEFAULT_CENTER_X, y: DEFAULT_CENTER_Y })
  const resolvedFloorId = target?.floorId ?? floorId

  return {
    id: generateId(),
    floorId: resolvedFloorId,
    pos: resolvedPos,
    rotationDeg: 0,
    scale: 1,
    layer,
  }
}

export function isEarthingSitplanPlacementId(
  project: EarthingSitplanProject | null | undefined,
  placementId: string,
): boolean {
  return getEarthingPlacements(project ? selectProjectElectricalInstallation(project) : undefined).some(
    (p) => p.id === placementId
  )
}
