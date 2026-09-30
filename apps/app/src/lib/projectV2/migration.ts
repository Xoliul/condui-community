import type {
  Door,
  Endpoint,
  Floor,
  JunctionPanelPlacement,
  Note,
  Placement,
  PlanWireRoute,
  PlanGraphicElement,
  Project,
  Stair,
  Window,
  Wall,
} from '@/types/schema'
import {
  PROJECT_V2_SCHEMA_VERSION,
  PROJECT_SCOPE_IDS,
  type AssetModelV2,
  type ChronologyModelV2,
  type CommentModelV2,
  type ElectricalDeviceV2,
  type ElementModelV2,
  type FloorV2,
  type GeometryModelV2,
  type LayerKindV2,
  type LayerModelV2,
  type ProjectV2,
  type ProjectCollaborationManifestV2,
  type ProjectScopeContributionV2,
  type RelationshipModelV2,
  type SystemModelV2,
  type ViewModelV2,
} from '@/types/projectV2'
import { emptyChronology } from '@/lib/chronology/chronology'
import { sanitizeLegacyV2Project } from './sanitizeLegacyV2Project'
import { normalizeLegacyPlanWiringAtBoundary } from './planWiring'
import { repairSeededWireRunRoutes, seedWireRunsFromLegacy } from './wireRunSeed'

type ProjectV2BeforeScopes = Omit<ProjectV2, 'schemaVersion' | 'collaboration'> & {
  schemaVersion: '2.0.0'
  collaboration?: never
}

/** Scoped V2 document before the Goal 19 wire-run bump; upgraded to `2.2.0` by seeding wire runs. */
type ProjectV2BeforeWireRuns = Omit<ProjectV2, 'schemaVersion'> & {
  schemaVersion: '2.1.0'
}

/** Wire-run document whose seeded runs may carry the `2.2.0` route loss; repaired to `2.3.0`. */
type ProjectV2BeforeWireRouteRepair = Omit<ProjectV2, 'schemaVersion'> & {
  schemaVersion: '2.2.0'
}

export type LegacyProjectDocument =
  | Project
  | ProjectV2
  | ProjectV2BeforeScopes
  | ProjectV2BeforeWireRuns
  | ProjectV2BeforeWireRouteRepair

const SYSTEM_BUILDING = 'system_building'
const SYSTEM_ELECTRICAL = 'system_electrical'
const SYSTEM_ANNOTATION = 'system_annotation'
const COMMENT_LAYER_GENERAL = 'comment_layer_general'
const ELECTRICAL_WIRING_LAYER_NAME = 'electrical-wiring'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

export function isProjectV2(value: unknown): value is ProjectV2 {
  return isRecord(value) && value.schemaVersion === PROJECT_V2_SCHEMA_VERSION
}

function isProjectV2BeforeScopes(value: unknown): value is ProjectV2BeforeScopes {
  return isRecord(value) && value.schemaVersion === '2.0.0'
}

function isProjectV2BeforeWireRuns(value: unknown): value is ProjectV2BeforeWireRuns {
  return isRecord(value) && value.schemaVersion === '2.1.0'
}

function isProjectV2BeforeWireRouteRepair(value: unknown): value is ProjectV2BeforeWireRouteRepair {
  return isRecord(value) && value.schemaVersion === '2.2.0'
}

export function isProjectV1(value: unknown): value is Project {
  return isRecord(value) && value.schemaVersion === '0.2.0' && isRecord(value.project)
}

function baseSystems(): SystemModelV2[] {
  return [
    {
      id: SYSTEM_BUILDING,
      scopeId: PROJECT_SCOPE_IDS.sharedBuilding,
      kind: 'building',
      name: 'Building',
    },
    {
      id: SYSTEM_ELECTRICAL,
      scopeId: PROJECT_SCOPE_IDS.electrical,
      kind: 'electrical',
      name: 'Electrical',
    },
    {
      id: SYSTEM_ANNOTATION,
      scopeId: PROJECT_SCOPE_IDS.coordination,
      kind: 'annotation',
      name: 'Annotations',
    },
  ]
}

function baseComments(): CommentModelV2 {
  return {
    settings: {
      enabled: false,
      anonymousCommentsEnabled: false,
    },
    layers: [
      {
        id: COMMENT_LAYER_GENERAL,
        name: 'Comments',
        visibleByDefault: true,
        color: '#f59e0b',
      },
    ],
    threads: [],
  }
}

function cloneChronology(chronology: ChronologyModelV2 | undefined): ChronologyModelV2 {
  return chronology
    ? (JSON.parse(JSON.stringify(chronology)) as ChronologyModelV2)
    : emptyChronology()
}

function layerIdFor(floorId: string | undefined, layerName: string): string {
  const normalized =
    layerName
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_') || 'layer'
  return floorId ? `layer_${floorId}_${normalized}` : `layer_${normalized}`
}

function elementIdForPlacement(endpointId: string, placementId: string): string {
  return `elem_${endpointId}_${placementId}`
}

function buildingLayerKind(kind: string): LayerKindV2 {
  if (kind === 'electrical') return 'electrical'
  if (kind === 'annotation') return 'annotation'
  if (kind === 'base-plan') return 'base-plan'
  return 'custom'
}

function collectLayers(project: Project): LayerModelV2[] {
  const byId = new Map<string, LayerModelV2>()

  for (const floor of project.floors) {
    const baseId = layerIdFor(floor.id, 'base-plan')
    byId.set(baseId, {
      id: baseId,
      name: `${floor.name} base plan`,
      kind: 'base-plan',
      systemId: SYSTEM_BUILDING,
      floorId: floor.id,
      visibleByDefault: true,
      locked: false,
      exportable: true,
    })

    for (const layerName of floor.layers ?? ['electrical']) {
      const id = layerIdFor(floor.id, layerName)
      byId.set(id, {
        id,
        name: `${floor.name} ${layerName}`,
        kind: buildingLayerKind(layerName),
        systemId: layerName === 'electrical' ? SYSTEM_ELECTRICAL : undefined,
        floorId: floor.id,
        visibleByDefault: true,
        locked: false,
        exportable: true,
      })
    }

    const wiringLayerId = layerIdFor(floor.id, ELECTRICAL_WIRING_LAYER_NAME)
    byId.set(wiringLayerId, {
      id: wiringLayerId,
      name: `${floor.name} wiring`,
      kind: 'electrical',
      systemId: SYSTEM_ELECTRICAL,
      floorId: floor.id,
      color: '#0ea5e9',
      visibleByDefault: true,
      locked: false,
      exportable: true,
    })
  }

  byId.set(layerIdFor(undefined, 'annotations'), {
    id: layerIdFor(undefined, 'annotations'),
    name: 'Annotations',
    kind: 'annotation',
    systemId: SYSTEM_ANNOTATION,
    visibleByDefault: true,
    exportable: true,
  })

  return Array.from(byId.values())
}

function assetFromFloor(floor: Floor): AssetModelV2[] {
  const assets: AssetModelV2[] = []
  if (floor.planImportAsset) {
    assets.push({
      id: floor.planImportAsset.id,
      kind:
        floor.planImportAsset.kind === 'cad-vector' || floor.planImportAsset.kind === 'pdf-vector'
          ? 'floorplan-vector'
          : floor.planImportAsset.kind === 'pdf-raster'
            ? 'floorplan-processed'
            : 'floorplan-source',
      sourceName: floor.planImportAsset.sourceName,
      dataUrl: floor.planImportAsset.dataUrl,
      svgContent: floor.planImportAsset.svgContent,
      width: floor.planImportAsset.width,
      height: floor.planImportAsset.height,
      pageIndex: floor.planImportAsset.pageIndex,
      pageCount: floor.planImportAsset.pageCount,
      crop: floor.planImportAsset.crop,
      darkModeAware: floor.planImportAsset.darkModeAware,
      grayscale: floor.planImportAsset.grayscale,
      legacy: floor.planImportAsset,
    })
  }
  if (
    floor.planAsset &&
    !assets.some((asset) => asset.id === floor.planAsset || asset.dataUrl === floor.planAsset)
  ) {
    assets.push({
      id: floor.planAsset,
      kind: 'floorplan-source',
      dataUrl: floor.planAsset,
    })
  }
  if (
    floor.planAssetProcessed &&
    !assets.some(
      (asset) => asset.id === floor.planAssetProcessed || asset.dataUrl === floor.planAssetProcessed
    )
  ) {
    assets.push({
      id: floor.planAssetProcessed,
      kind: 'floorplan-processed',
      dataUrl: floor.planAssetProcessed,
    })
  }
  return assets
}

function floorToV2(floor: Floor): FloorV2 {
  return {
    id: floor.id,
    name: floor.name,
    planAssetId: floor.planImportAsset?.id ?? floor.planAsset,
    processedPlanAssetId:
      (floor.planImportAsset?.processedDataUrl
        ? `${floor.planImportAsset.id}-processed`
        : undefined) ?? floor.planAssetProcessed,
    scale: floor.scale,
    planScaleNeedsCalibration: floor.planScaleNeedsCalibration,
    planImageOffset: floor.planImageOffset,
    planImageRotationDeg: floor.planImageRotationDeg,
    planImageOpacity: floor.planImageOpacity,
    sitplanSymbolSizeCm: floor.sitplanSymbolSizeCm,
    hiddenSitplanElementIds: floor.hiddenSitplanPlacementIds,
  }
}

function wallGeometry(wall: Wall): GeometryModelV2 {
  return { kind: 'polyline', points: wall.points }
}

function openingGeometry(opening: Door | Window): GeometryModelV2 {
  return {
    kind: 'point',
    position: { x: opening.position, y: 0 },
  }
}

function stairGeometry(stair: Stair): GeometryModelV2 {
  return { kind: 'polyline', points: stair.points }
}

function graphicGeometry(graphic: PlanGraphicElement): GeometryModelV2 {
  return {
    kind: 'rect',
    position: graphic.pos,
    width: graphic.width,
    height: graphic.height,
    rotationDeg: graphic.rotationDeg,
  }
}

function buildingElementsFromFloor(floor: Floor): ElementModelV2[] {
  const floorPlan = floor.floorPlan
  if (!floorPlan) return []

  const layerId = layerIdFor(floor.id, 'base-plan')
  const common = {
    floorId: floor.id,
    systemId: SYSTEM_BUILDING,
    layerId,
  }

  return [
    ...floorPlan.walls.map((wall) => ({
      ...common,
      id: `elem_wall_${wall.id}`,
      kind: 'building.wall',
      geometry: wallGeometry(wall),
      properties: {
        v1: wall,
        curve: wall.curve,
        thickness: wall.thickness,
        masterWallThickness: floorPlan.masterWallThickness,
      },
      sourceRefs: [{ kind: 'v1' as const, id: wall.id, path: 'floor.floorPlan.walls' }],
    })),
    ...floorPlan.doors.map((door) => ({
      ...common,
      id: `elem_door_${door.id}`,
      kind: door.isOpening ? 'building.opening' : 'building.door',
      geometry: openingGeometry(door),
      properties: { v1: door },
      sourceRefs: [{ kind: 'v1' as const, id: door.id, path: 'floor.floorPlan.doors' }],
    })),
    ...floorPlan.windows.map((window) => ({
      ...common,
      id: `elem_window_${window.id}`,
      kind: 'building.window',
      geometry: openingGeometry(window),
      properties: { v1: window },
      sourceRefs: [{ kind: 'v1' as const, id: window.id, path: 'floor.floorPlan.windows' }],
    })),
    ...(floorPlan.stairs ?? []).map((stair) => ({
      ...common,
      id: `elem_stair_${stair.id}`,
      kind: 'building.stair',
      geometry: stairGeometry(stair),
      properties: { v1: stair },
      sourceRefs: [{ kind: 'v1' as const, id: stair.id, path: 'floor.floorPlan.stairs' }],
    })),
    ...(floorPlan.graphicElements ?? []).map((graphic) => ({
      ...common,
      id: `elem_graphic_${graphic.id}`,
      kind: `building.graphic.${graphic.kind}`,
      layerId: graphic.layer ? layerIdFor(floor.id, graphic.layer) : layerId,
      geometry: graphicGeometry(graphic),
      properties: { v1: graphic, assetId: graphic.assetId },
      sourceRefs: [
        { kind: 'v1' as const, id: graphic.id, path: 'floor.floorPlan.graphicElements' },
      ],
    })),
  ]
}

function placementToElement(endpoint: Endpoint, placement: Placement): ElementModelV2 {
  return {
    id: elementIdForPlacement(endpoint.id, placement.id),
    kind: `electrical.${endpoint.symbol ?? endpoint.type}`,
    name: endpoint.label,
    floorId: placement.floorId,
    systemId: SYSTEM_ELECTRICAL,
    layerId: layerIdFor(placement.floorId, placement.layer),
    geometry: {
      kind: 'point',
      position: placement.pos,
      rotationDeg: placement.rotationDeg,
      scale: placement.scale,
    },
    properties: {
      placement,
      endpointType: endpoint.type,
      symbol: endpoint.symbol,
      locked: placement.locked,
      style: placement.style,
    },
    classification: {
      eendraKind: endpoint.symbol ?? endpoint.type,
    },
    sourceRefs: [
      { kind: 'v1', id: endpoint.id, path: 'panels.circuits.endpoints' },
      { kind: 'v1', id: placement.id, path: 'endpoint.placements' },
    ],
  }
}

function planWireRouteToElement(route: PlanWireRoute): ElementModelV2 {
  return {
    id: `elem_plan_wire_${route.id}`,
    scopeId: 'electrical',
    kind: `electrical.plan-wire.${route.kind}`,
    floorId: route.floorId,
    systemId: SYSTEM_ELECTRICAL,
    layerId: layerIdFor(route.floorId, ELECTRICAL_WIRING_LAYER_NAME),
    geometry: { kind: 'polyline', points: route.waypoints ?? [] },
    properties: {
      route,
      source: route.source,
      circuitId: route.circuitId,
      branchId: route.branchId,
      from: route.from,
      to: route.to,
    },
    sourceRefs: [{ kind: 'v1', id: route.id, path: 'planWiring.routes' }],
  }
}

function noteToElement(note: Note, scope: 'sitplan' | 'eendraad'): ElementModelV2 {
  return {
    id: `elem_note_${scope}_${note.id}`,
    kind: 'annotation.note',
    name: note.text,
    floorId: note.floorId,
    systemId: SYSTEM_ANNOTATION,
    layerId: layerIdFor(note.floorId, 'annotations'),
    geometry: { kind: 'point', position: note.pos },
    properties: {
      v1: note,
      scope,
      fontSize: note.fontSize,
      formatting: note.formatting,
      panelId: note.panelId,
    },
    sourceRefs: [{ kind: 'v1', id: note.id, path: `${scope}Notes` }],
  }
}

function junctionPanelToElement(placement: JunctionPanelPlacement): ElementModelV2 {
  return {
    id: `elem_junction_panel_${placement.id}`,
    kind: 'electrical.junction-panel',
    name: placement.label,
    floorId: placement.floorId,
    systemId: SYSTEM_ELECTRICAL,
    layerId: layerIdFor(placement.floorId, placement.layer ?? 'electrical'),
    geometry: {
      kind: 'point',
      position: placement.pos,
      rotationDeg: placement.rotationDeg,
      scale: placement.scale,
    },
    properties: { placement },
    sourceRefs: [{ kind: 'v1', id: placement.id, path: 'installation.junctionPanelPlacements' }],
  }
}

function collectElectricalElementsAndDevicesFromCompatibility(
  installation: Project['installation'],
  panels: Project['panels']
): {
  elements: ElementModelV2[]
  devices: ElectricalDeviceV2[]
  relationships: RelationshipModelV2[]
} {
  const elements: ElementModelV2[] = []
  const devices: ElectricalDeviceV2[] = []
  const relationships: RelationshipModelV2[] = []

  const walkCircuit = (circuitId: string, panelId: string | undefined, endpoints: Endpoint[]) => {
    for (const endpoint of endpoints) {
      const elementIds = endpoint.placements.map((placement) => {
        const element = placementToElement(endpoint, placement)
        elements.push(element)
        relationships.push({
          id: `rel_${circuitId}_${element.id}`,
          kind: 'electrical-circuit',
          fromElementId: `legacy_circuit_${circuitId}`,
          toElementId: element.id,
          systemId: SYSTEM_ELECTRICAL,
          properties: { circuitId, endpointId: endpoint.id },
        })
        return element.id
      })

      devices.push({
        id: `edev_${endpoint.id}`,
        legacyEndpointId: endpoint.id,
        elementIds,
        circuitId,
        panelId,
        symbol: endpoint.symbol,
        type: endpoint.type,
        properties: {
          label: endpoint.label,
          controlledEndpointIds: endpoint.controlledEndpointIds,
        },
      })
    }
  }

  const walkPanels = (panelsToWalk: Project['panels']) => {
    for (const panel of panelsToWalk) {
      for (const circuit of panel.circuits) {
        walkCircuit(circuit.id, panel.id, circuit.endpoints)
      }
      for (const protection of panel.protections) {
        for (const circuit of protection.circuits ?? []) {
          walkCircuit(circuit.id, panel.id, circuit.endpoints)
        }
      }
      walkPanels(panel.subPanels ?? [])
    }
  }

  walkPanels(panels)

  for (const placement of installation.junctionPanelPlacements ?? []) {
    elements.push(junctionPanelToElement(placement))
  }

  for (const placement of installation.earthingPlacements ?? []) {
    elements.push({
      id: `elem_earthing_${placement.id}`,
      kind: 'electrical.earthing',
      floorId: placement.floorId,
      systemId: SYSTEM_ELECTRICAL,
      layerId: layerIdFor(placement.floorId, placement.layer ?? 'electrical'),
      geometry: {
        kind: 'point',
        position: placement.pos,
        rotationDeg: placement.rotationDeg,
        scale: placement.scale,
      },
      properties: { placement },
      sourceRefs: [{ kind: 'v1', id: placement.id, path: 'installation.earthingPlacements' }],
    })
  }

  return { elements, devices, relationships }
}

function collectElectricalElementsAndDevices(project: Project): {
  elements: ElementModelV2[]
  devices: ElectricalDeviceV2[]
  relationships: RelationshipModelV2[]
} {
  return collectElectricalElementsAndDevicesFromCompatibility(project.installation, project.panels)
}

function collectViews(project: Project, layers: LayerModelV2[]): ViewModelV2[] {
  const floorViews = project.floors.map((floor) => ({
    id: `view_floor_${floor.id}`,
    kind: 'floor-plan' as const,
    name: floor.name,
    floorId: floor.id,
    visibleLayerIds: layers.filter((layer) => layer.floorId === floor.id).map((layer) => layer.id),
    hiddenElementIds: floor.hiddenSitplanPlacementIds,
  }))

  const panelViews = project.panels.map((panel) => ({
    id: `view_panel_${panel.id}`,
    kind: 'one-wire' as const,
    name: panel.name,
    panelId: panel.id,
  }))

  return [...floorViews, ...panelViews]
}

function scopeIdForSystem(systemId: string | undefined): string {
  if (systemId === SYSTEM_BUILDING) return PROJECT_SCOPE_IDS.sharedBuilding
  if (systemId === SYSTEM_ELECTRICAL) return PROJECT_SCOPE_IDS.electrical
  return PROJECT_SCOPE_IDS.coordination
}

function applyScopeContract(
  project: Omit<ProjectV2, 'schemaVersion' | 'collaboration'>,
  contributions?: ProjectScopeContributionV2[]
): ProjectV2 {
  const systems = project.systems.map((system) => ({
    ...system,
    scopeId: system.scopeId ?? scopeIdForSystem(system.id),
  }))
  const systemScopeById = new Map(systems.map((system) => [system.id, system.scopeId]))
  const layers = project.layers.map((layer) => ({
    ...layer,
    scopeId:
      layer.scopeId ??
      (layer.kind === 'base-plan' || layer.kind === 'building'
        ? PROJECT_SCOPE_IDS.sharedBuilding
        : layer.kind === 'electrical'
          ? PROJECT_SCOPE_IDS.electrical
          : ((layer.systemId ? systemScopeById.get(layer.systemId) : undefined) ??
            PROJECT_SCOPE_IDS.coordination)),
  }))
  const layerScopeById = new Map(layers.map((layer) => [layer.id, layer.scopeId]))
  const elements = project.elements.map((element) => ({
    ...element,
    scopeId:
      element.scopeId ??
      (element.layerId ? layerScopeById.get(element.layerId) : undefined) ??
      (element.systemId ? systemScopeById.get(element.systemId) : undefined) ??
      PROJECT_SCOPE_IDS.coordination,
  }))
  const relationships = project.relationships.map((relationship) => ({
    ...relationship,
    scopeId:
      relationship.scopeId ??
      (relationship.systemId ? systemScopeById.get(relationship.systemId) : undefined) ??
      PROJECT_SCOPE_IDS.coordination,
  }))
  const views = project.views.map((view) => ({
    ...view,
    scopeId:
      view.scopeId ??
      (view.kind === 'one-wire' || view.kind === 'panel-board'
        ? PROJECT_SCOPE_IDS.electrical
        : PROJECT_SCOPE_IDS.sharedBuilding),
  }))
  const assets = project.assets.map((asset) => ({
    ...asset,
    scopeId:
      asset.scopeId ??
      (asset.kind.startsWith('floorplan-')
        ? PROJECT_SCOPE_IDS.sharedBuilding
        : PROJECT_SCOPE_IDS.electrical),
  }))

  const scopes: ProjectCollaborationManifestV2['scopes'] = [
    {
      id: PROJECT_SCOPE_IDS.sharedBuilding,
      kind: 'shared-building',
      status: 'active',
      systemIds: systems
        .filter((item) => item.scopeId === PROJECT_SCOPE_IDS.sharedBuilding)
        .map((item) => item.id),
      layerIds: layers
        .filter((item) => item.scopeId === PROJECT_SCOPE_IDS.sharedBuilding)
        .map((item) => item.id),
      viewIds: views
        .filter((item) => item.scopeId === PROJECT_SCOPE_IDS.sharedBuilding)
        .map((item) => item.id),
      assetIds: assets
        .filter((item) => item.scopeId === PROJECT_SCOPE_IDS.sharedBuilding)
        .map((item) => item.id),
    },
    {
      id: PROJECT_SCOPE_IDS.electrical,
      kind: 'discipline',
      discipline: 'electrical',
      status: 'active',
      systemIds: systems
        .filter((item) => item.scopeId === PROJECT_SCOPE_IDS.electrical)
        .map((item) => item.id),
      layerIds: layers
        .filter((item) => item.scopeId === PROJECT_SCOPE_IDS.electrical)
        .map((item) => item.id),
      viewIds: views
        .filter((item) => item.scopeId === PROJECT_SCOPE_IDS.electrical)
        .map((item) => item.id),
      assetIds: assets
        .filter((item) => item.scopeId === PROJECT_SCOPE_IDS.electrical)
        .map((item) => item.id),
    },
    {
      id: PROJECT_SCOPE_IDS.coordination,
      kind: 'coordination',
      status: 'active',
      systemIds: systems
        .filter((item) => item.scopeId === PROJECT_SCOPE_IDS.coordination)
        .map((item) => item.id),
      layerIds: layers
        .filter((item) => item.scopeId === PROJECT_SCOPE_IDS.coordination)
        .map((item) => item.id),
      viewIds: views
        .filter((item) => item.scopeId === PROJECT_SCOPE_IDS.coordination)
        .map((item) => item.id),
      assetIds: assets
        .filter((item) => item.scopeId === PROJECT_SCOPE_IDS.coordination)
        .map((item) => item.id),
    },
  ]

  // Goal 19 / ADR-0002: finalize to the current canonical shape, seeding the WireRun collection
  // best-effort when absent. Seed only when missing so an edited/persisted project is never
  // overwritten on re-save. The scope contract and wire-run seed together make a current document.
  const electrical = project.disciplines.electrical
  const disciplines =
    electrical && !Array.isArray(electrical.wireRuns)
      ? {
          ...project.disciplines,
          electrical: { ...electrical, wireRuns: seedWireRunsFromLegacy(project) },
        }
      : project.disciplines

  return {
    ...project,
    disciplines,
    schemaVersion: PROJECT_V2_SCHEMA_VERSION,
    collaboration: {
      version: 1,
      scopes,
      contributions: contributions && contributions.length > 0 ? contributions : undefined,
    },
    systems,
    layers,
    elements,
    relationships,
    views,
    assets,
  }
}

export function migrateProjectV1ToV2(project: Project): ProjectV2 {
  const chronology = cloneChronology(
    (project as Project & { chronology?: ChronologyModelV2 }).chronology
  )
  const layers = collectLayers(project)
  const electrical = collectElectricalElementsAndDevices(project)
  const planWireElements = (project.planWiring?.routes ?? []).map(planWireRouteToElement)
  const sitplanNoteElements = (project.sitplanNotes ?? []).map((note) =>
    noteToElement(note, 'sitplan')
  )

  return applyScopeContract({
    project: {
      id: project.project.id,
      name: project.project.name,
      createdAt: project.project.createdAt,
      updatedAt: project.project.updatedAt,
      locale: project.project.locale,
      yearOfConstruction: project.project.yearOfConstruction,
      installDateColors: project.project.installDateColors,
      meterEanCode: project.project.meterEanCode,
      lastActiveFloorId: project.project.lastActiveFloorId,
      lastActivePanelId: project.project.lastActivePanelId,
      lastViewportLayout: project.project.lastViewportLayout,
      planFloorOverlayVisibleByBaseFloorId: project.project.planFloorOverlayVisibleByBaseFloorId,
      protectionCreationTemplates: project.project.protectionCreationTemplates,
      customer: project.project.customer,
      inspectionAgency: project.project.inspectionAgency,
      showInspectionAgencyInInfoBlock: project.project.showInspectionAgencyInInfoBlock,
      installerOverride: project.project.installerOverride,
      importSources: project.project.importSources,
    },
    site: {
      address: project.installation.address,
    },
    building: {
      planScale: project.floors.find((floor) => floor.scale)?.scale,
      floors: project.floors.map(floorToV2),
    },
    systems: baseSystems(),
    layers,
    elements: [
      ...project.floors.flatMap(buildingElementsFromFloor),
      ...electrical.elements,
      ...planWireElements,
      ...sitplanNoteElements,
    ],
    relationships: electrical.relationships,
    views: collectViews(project, layers),
    assets: project.floors.flatMap(assetFromFloor),
    disciplines: {
      electrical: {
        installation: project.installation,
        panels: project.panels,
        devices: electrical.devices,
        planWiring: project.planWiring
          ? { version: 1, routes: [], visibility: project.planWiring.visibility }
          : undefined,
        oneWire: {
          notes: project.eendraadNotes,
          frames: project.eendraadFrames,
          wireSegments: project.wireSegments,
        },
      },
    },
    comments: baseComments(),
    validation: {
      quarantinedItems: project.quarantinedItems,
    },
    chronology,
  })
}

/**
 * One forward schema-version upgrade. Ordered oldest→newest in {@link SCHEMA_UPGRADE_STEPS}.
 *
 * This is deliberately separate from the boundary healers below: a step advances the persisted
 * schema *version*, a healer normalizes legacy shapes *within* the current version. Adding a new
 * schema version (e.g. `2.1.0 → 2.2.0`) means appending one entry here, not editing this file's
 * control flow.
 */
interface SchemaUpgradeStep {
  /** Source schema version this step accepts. Documentation for the ordered chain. */
  from: string
  /** Schema version produced by {@link SchemaUpgradeStep.apply}. */
  to: string
  /** Whether {@link document} is at this step's source version. */
  matches: (document: unknown) => boolean
  /** Upgrade the document one generation forward. */
  apply: (document: LegacyProjectDocument) => ProjectV2
}

/**
 * Ordered schema upgrades, oldest→newest. `applyScopeContract` finalizes any pre-scope document to
 * the current canonical shape (scopes + wire-run seed + current version), so the V1 and pre-scope
 * steps reach the current version directly. A `2.1.0` document already has scopes, so its step
 * re-finalizes to seed wire runs. A `2.2.0` document only needs its seeded wire-run routes repaired.
 * Adding a future version means appending one entry here.
 */
const SCHEMA_UPGRADE_STEPS: SchemaUpgradeStep[] = [
  {
    from: '0.2.0',
    to: PROJECT_V2_SCHEMA_VERSION,
    matches: isProjectV1,
    apply: (document) => migrateProjectV1ToV2(document as Project),
  },
  {
    from: '2.0.0',
    to: PROJECT_V2_SCHEMA_VERSION,
    matches: isProjectV2BeforeScopes,
    apply: (document) => {
      const { schemaVersion: _schemaVersion, ...project } = document as ProjectV2BeforeScopes
      return applyScopeContract(project)
    },
  },
  {
    from: '2.1.0',
    to: PROJECT_V2_SCHEMA_VERSION,
    matches: isProjectV2BeforeWireRuns,
    apply: (document) => {
      const { schemaVersion: _schemaVersion, collaboration, ...project } =
        document as ProjectV2BeforeWireRuns
      return applyScopeContract(project, collaboration?.contributions)
    },
  },
  {
    from: '2.2.0',
    to: PROJECT_V2_SCHEMA_VERSION,
    matches: isProjectV2BeforeWireRouteRepair,
    apply: (document) => {
      const project = document as ProjectV2BeforeWireRouteRepair
      const electrical = project.disciplines.electrical
      const wireRuns = electrical?.wireRuns
      return {
        ...project,
        schemaVersion: PROJECT_V2_SCHEMA_VERSION,
        disciplines:
          electrical && Array.isArray(wireRuns)
            ? {
                ...project.disciplines,
                electrical: {
                  ...electrical,
                  wireRuns: repairSeededWireRunRoutes(project, wireRuns),
                },
              }
            : project.disciplines,
      }
    },
  },
]

function upgradeDocumentToCurrentSchema(document: LegacyProjectDocument): ProjectV2 {
  let current: LegacyProjectDocument = document
  // Bounded by the number of steps (+1) so a mis-specified cyclic table cannot loop forever.
  for (let guard = 0; guard <= SCHEMA_UPGRADE_STEPS.length; guard += 1) {
    if (isProjectV2(current)) return current
    const step = SCHEMA_UPGRADE_STEPS.find((candidate) => candidate.matches(current))
    if (!step) break
    current = step.apply(current)
  }
  if (isProjectV2(current)) return current
  throw new Error('Unsupported project schema version.')
}

/**
 * Idempotent, same-version normalizer that heals a legacy shape inside an already-current document.
 * Distinct from a schema upgrade: healers never change the schema version.
 */
type BoundaryHealer = (project: ProjectV2) => void

/** Same-version boundary healers, applied after the document is at the current schema version. */
const BOUNDARY_HEALERS: BoundaryHealer[] = [normalizeLegacyPlanWiringAtBoundary]

function applyBoundaryHealers(project: ProjectV2): void {
  for (const heal of BOUNDARY_HEALERS) heal(project)
}

/**
 * Whether an already-current document carries any legacy shape a healer would rewrite. Lets the
 * common "already current, nothing legacy" path skip cloning, preserving the original fast path.
 */
function needsBoundaryHealing(project: ProjectV2): boolean {
  return (project.disciplines.electrical?.planWiring?.routes.length ?? 0) > 0
}

export function normalizeStoredProjectToV2(document: LegacyProjectDocument): ProjectV2 {
  if (isProjectV2(document)) {
    // Already at the current schema version: only clone + heal when a legacy shape is present.
    if (!needsBoundaryHealing(document)) return document
    const normalized = cloneJsonProject(document)
    applyBoundaryHealers(normalized)
    return normalized
  }
  const upgraded = upgradeDocumentToCurrentSchema(document)
  applyBoundaryHealers(upgraded)
  return upgraded
}

function cloneJsonProject(project: ProjectV2): ProjectV2 {
  if (typeof structuredClone === 'function') return structuredClone(project)
  return JSON.parse(JSON.stringify(project)) as ProjectV2
}

export function cloneCanonicalProjectForStorage(project: ProjectV2): ProjectV2 {
  // V2 graph containers are canonical runtime state. Legacy V1 documents are materialized once
  // by migrateProjectV1ToV2; the storage boundary must only clone, never regenerate those facts
  // from compatibility/domain mirrors.
  return cloneJsonProject(project)
}

function stripRuntimeElectricalCompatibilityFields(project: ProjectV2): ProjectV2 {
  const runtimeProject = project as ProjectV2 & {
    installation?: unknown
    panels?: unknown
    floors?: unknown
    sitplanNotes?: unknown
    eendraadNotes?: unknown
    eendraadFrames?: unknown
    wireSegments?: unknown
    planWiring?: unknown
    quarantinedItems?: unknown
  }
  if (
    !Object.prototype.hasOwnProperty.call(runtimeProject, 'installation') &&
    !Object.prototype.hasOwnProperty.call(runtimeProject, 'panels') &&
    !Object.prototype.hasOwnProperty.call(runtimeProject, 'floors') &&
    !Object.prototype.hasOwnProperty.call(runtimeProject, 'sitplanNotes') &&
    !Object.prototype.hasOwnProperty.call(runtimeProject, 'eendraadNotes') &&
    !Object.prototype.hasOwnProperty.call(runtimeProject, 'eendraadFrames') &&
    !Object.prototype.hasOwnProperty.call(runtimeProject, 'wireSegments') &&
    !Object.prototype.hasOwnProperty.call(runtimeProject, 'planWiring') &&
    !Object.prototype.hasOwnProperty.call(runtimeProject, 'quarantinedItems')
  ) {
    return project
  }
  const {
    installation: _installation,
    panels: _panels,
    floors: _floors,
    sitplanNotes: _sitplanNotes,
    eendraadNotes: _eendraadNotes,
    eendraadFrames: _eendraadFrames,
    wireSegments: _wireSegments,
    planWiring: _planWiring,
    quarantinedItems: _quarantinedItems,
    ...nativeProject
  } = runtimeProject
  return nativeProject as ProjectV2
}

export function projectToStoredProjectV2(project: LegacyProjectDocument): ProjectV2 {
  const normalized = sanitizeLegacyV2Project(normalizeStoredProjectToV2(project)).project
  const stored = stripRuntimeElectricalCompatibilityFields(
    cloneCanonicalProjectForStorage(normalized)
  )
  const { schemaVersion: _schemaVersion, collaboration, ...nativeProject } = stored
  return applyScopeContract(nativeProject, collaboration.contributions)
}
