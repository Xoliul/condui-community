import type { Floor, ImportedPlanAsset, Placement, Point2 } from '@/types/schema'
import type { ProjectV2 } from '@/types/projectV2'
import { getAllEndpoints, getAllCircuits } from '@/lib/eendraad/projectElectricalDomain'
import { getAllSupplyTrunkDevices } from '@/lib/feedTopology'
import {
  getProjectElectricalInstallation,
  getProjectElectricalPanels,
  selectProjectAuxiliaryElectricalEnclosures,
} from '@/lib/projectV2/electrical'
import { mutateBuildingFloorView, selectProjectPlanScale } from '@/lib/projectV2/buildingFloors'
import {
  selectProjectPlanWireRoutes,
  replacePlanWireRoutesForProject,
} from '@/lib/projectV2/planWiring'
import { editProjectWireRuns } from '@/lib/projectV2/wireRuns'
import { querySitplanNotes, replaceSitplanNotes } from '@/lib/projectV2/annotations'
import { DEFAULT_PLAN_PX_PER_METER, isPositiveFinite, resolvePlanPxPerMeter } from './planScale'

export function scalePlanPoint(
  point: Point2,
  factor: number,
  origin: Point2 = { x: 0, y: 0 }
): Point2 {
  return {
    x: origin.x + (point.x - origin.x) * factor,
    y: origin.y + (point.y - origin.y) * factor,
  }
}

/** Resize the display coordinates without resampling the source pixels or losing CAD mapping. */
export function rescaleImportedPlanAsset(
  asset: ImportedPlanAsset,
  factor: number
): ImportedPlanAsset {
  const rect = (r: { x: number; y: number; width: number; height: number }) => ({
    x: r.x * factor,
    y: r.y * factor,
    width: r.width * factor,
    height: r.height * factor,
  })
  const cad = asset.cadReference
  return {
    ...asset,
    width: asset.width * factor,
    height: asset.height * factor,
    ...(cad
      ? {
          cadReference: {
            ...cad,
            uncroppedAssetSize: {
              width: cad.uncroppedAssetSize.width * factor,
              height: cad.uncroppedAssetSize.height * factor,
            },
            cropInAssetSpace: rect(cad.cropInAssetSpace),
            referenceCropAssetRect: cad.referenceCropAssetRect
              ? rect(cad.referenceCropAssetRect)
              : undefined,
            svgNormalization: {
              ...cad.svgNormalization,
              scale: cad.svgNormalization.scale * factor,
            },
            planImageOffset: scalePlanPoint(cad.planImageOffset, factor),
          },
        }
      : {}),
  }
}

export function rescaleFloorPlan(
  plan: NonNullable<Floor['floorPlan']>,
  factor: number,
  origin: Point2
): NonNullable<Floor['floorPlan']> {
  const point = (p: Point2) => scalePlanPoint(p, factor, origin)
  const opening = <T extends { width: number; centerAlongSegment?: number }>(o: T): T => ({
    ...o,
    width: o.width * factor,
    ...(o.centerAlongSegment != null ? { centerAlongSegment: o.centerAlongSegment * factor } : {}),
  })
  return {
    ...plan,
    walls: plan.walls.map((wall) => ({ ...wall, points: wall.points.map(point) })),
    doors: plan.doors.map(opening),
    windows: plan.windows.map(opening),
    stairs: plan.stairs?.map((stair) => ({
      ...stair,
      points: stair.points.map(point),
      width: stair.width * factor,
      stepDepth: stair.stepDepth * factor,
      ...(stair.spiralPoleDiameter != null
        ? { spiralPoleDiameter: stair.spiralPoleDiameter * factor }
        : {}),
    })),
    graphicElements: plan.graphicElements?.map((element) => ({
      ...element,
      pos: point(element.pos),
      width: element.width * factor,
      height: element.height * factor,
    })),
  }
}

/** All physical placement owners, including the supply and grounding paths. */
export function editPlanPlacements(
  project: ProjectV2,
  edit: (placement: Pick<Placement, 'id' | 'floorId' | 'pos'>) => void
): void {
  const panels = getProjectElectricalPanels(project)
  const visitPanel = (panel: (typeof panels)[number]) => {
    for (const endpoint of getAllEndpoints(panel))
      for (const placement of endpoint.placements) edit(placement)
    for (const circuit of getAllCircuits(panel)) {
      for (const device of circuit.trunkDevices ?? [])
        for (const placement of device.placements ?? []) edit(placement)
    }
    for (const device of panel.groundTrunkDevices ?? [])
      for (const placement of device.placements ?? []) edit(placement)
    for (const child of panel.subPanels ?? []) visitPanel(child)
  }
  // getAllEndpoints includes descendants; each physical placement must be edited once.
  const seen = new Set<string>()
  const apply = edit
  edit = (placement) => {
    if (!seen.has(placement.id)) {
      seen.add(placement.id)
      apply(placement)
    }
  }
  for (const panel of panels) visitPanel(panel)
  for (const device of getAllSupplyTrunkDevices(project))
    for (const placement of device.placements ?? []) edit(placement)
  const installation = getProjectElectricalInstallation(project)
  for (const device of installation?.groundTrunkDevices ?? [])
    for (const placement of device.placements ?? []) edit(placement)
  for (const placement of installation?.junctionPanelPlacements ?? []) edit(placement)
  for (const placement of installation?.earthingPlacements ?? []) edit(placement)
  for (const enclosure of selectProjectAuxiliaryElectricalEnclosures(project))
    for (const placement of enclosure.placements ?? []) edit(placement)
}

export function rescalePlanFloorExtras(
  project: ProjectV2,
  floorId: string,
  factor: number,
  origin: Point2
): void {
  const point = (p: Point2) => scalePlanPoint(p, factor, origin)
  replacePlanWireRoutesForProject(
    project,
    selectProjectPlanWireRoutes(project).map((route) => ({
      ...route,
      ...(route.floorId === floorId
        ? {
            waypoints: route.waypoints?.map(point),
            riserExit: route.riserExit
              ? {
                  ...route.riserExit,
                  pos: route.riserExit.pos ? point(route.riserExit.pos) : undefined,
                }
              : undefined,
          }
        : {}),
      ...(route.riser && route.riser.fromFloorId === floorId
        ? { riser: { ...route.riser, pos: route.riser.pos ? point(route.riser.pos) : undefined } }
        : {}),
    }))
  )
  const notes = querySitplanNotes(project)
  const noteElementIds = new Set(notes.map((note) => `elem_note_sitplan_${note.id}`))
  for (const element of project.elements) {
    if (
      element.floorId !== floorId ||
      !element.kind.startsWith('annotation.') ||
      noteElementIds.has(element.id)
    )
      continue
    const geometry = element.geometry
    if (geometry.kind === 'polyline' || geometry.kind === 'polygon')
      geometry.points = geometry.points.map(point)
    else {
      geometry.position = point(geometry.position)
      if (geometry.kind === 'rect') {
        geometry.width *= factor
        geometry.height *= factor
      }
    }
  }
  replaceSitplanNotes(
    project,
    notes.map((note) =>
      note.floorId === floorId
        ? { ...note, pos: point(note.pos), fontSize: note.fontSize * factor }
        : note
    )
  )
}

/** Preserve the physical size of every other floor when the building's unit conversion changes. */
export function preserveOtherFloorsOnScaleChange(
  project: ProjectV2,
  activeFloorId: string,
  scale: Floor['scale']
): void {
  const before = resolvePlanPxPerMeter(selectProjectPlanScale(project)) ?? DEFAULT_PLAN_PX_PER_METER
  const after = resolvePlanPxPerMeter(scale)
  if (!isPositiveFinite(after) || Math.abs(after / before - 1) < 1e-9) return
  const factor = after / before
  for (const floor of [...project.building.floors]) {
    if (floor.id === activeFloorId) continue
    const origin = { x: 0, y: 0 }
    mutateBuildingFloorView(project, floor.id, (view) => {
      if (view.floorPlan) view.floorPlan = rescaleFloorPlan(view.floorPlan, factor, origin)
      if (view.planImportAsset)
        view.planImportAsset = rescaleImportedPlanAsset(view.planImportAsset, factor)
      if (view.planImageOffset) view.planImageOffset = scalePlanPoint(view.planImageOffset, factor)
    })
    editPlanPlacements(project, (placement) => {
      if (placement.floorId === floor.id) placement.pos = scalePlanPoint(placement.pos, factor)
    })
    rescalePlanFloorExtras(project, floor.id, factor, origin)
  }
  invalidatePlanLengthEstimates(project)
}

export function invalidatePlanLengthEstimates(project: ProjectV2): void {
  for (const run of editProjectWireRuns(project)) {
    for (const [anchor, source] of Object.entries(run.segmentLengthSources ?? {})) {
      if (source === 'estimated') {
        run.segmentLengthSources![anchor] = 'estimated-stale'
        // Older readers also see a missing length, never an obsolete accepted value.
        if (run.segmentLengths) delete run.segmentLengths[anchor]
      }
    }
  }
}
