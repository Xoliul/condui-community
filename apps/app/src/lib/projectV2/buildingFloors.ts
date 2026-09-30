import type {
  CadReferenceV1,
  Door,
  Floor,
  ImportedPlanAsset,
  PlanGraphicElement,
  Stair,
  Wall,
  Window,
} from '@/types/schema'
import type {
  AssetModelV2,
  BuildingModelV2,
  ElementModelV2,
  FloorV2,
  GeometryModelV2,
} from '@/types/projectV2'
import { resolvePlanPxPerMeter } from '@/lib/plan/planScale'

type ProjectWithCompatibilityBuilding = {
  floors?: Floor[]
}

export type ProjectWithOptionalV2Building = ProjectWithCompatibilityBuilding & {
  building?: Partial<BuildingModelV2>
  assets?: AssetModelV2[]
  elements?: ElementModelV2[]
}

type CompatibilityFloorsCacheEntry = {
  assets: AssetModelV2[] | undefined
  elements: ElementModelV2[] | undefined
  floors: Floor[]
}

const compatibilityFloorsByNativeFloors = new WeakMap<
  NonNullable<BuildingModelV2['floors']>,
  CompatibilityFloorsCacheEntry
>()
const floorPlansByElements = new WeakMap<ElementModelV2[], Map<string, Floor['floorPlan']>>()

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function isPoint(value: unknown): value is { x: number; y: number } {
  return isRecord(value) && typeof value.x === 'number' && typeof value.y === 'number'
}

function isPointArray(value: unknown): value is Array<{ x: number; y: number }> {
  return Array.isArray(value) && value.every(isPoint)
}

function wallCurveFromProperties(value: unknown): Wall['curve'] | undefined {
  if (!isRecord(value)) return undefined
  if (value.kind !== 'rationalQuadratic') return undefined
  if (typeof value.weight !== 'number' || !Number.isFinite(value.weight) || value.weight <= 0) {
    return undefined
  }
  return { kind: 'rationalQuadratic', weight: value.weight }
}

function isWall(value: unknown): value is Wall {
  return isRecord(value) && typeof value.id === 'string' && isPointArray(value.points)
}

function isDoor(value: unknown): value is Door {
  return (
    isRecord(value) &&
    typeof value.id === 'string' &&
    typeof value.wallId === 'string' &&
    typeof value.position === 'number'
  )
}

function isWindow(value: unknown): value is Window {
  return (
    isRecord(value) &&
    typeof value.id === 'string' &&
    typeof value.wallId === 'string' &&
    typeof value.position === 'number'
  )
}

function isStair(value: unknown): value is Stair {
  return isRecord(value) && typeof value.id === 'string' && isPointArray(value.points)
}

function isPlanGraphicElement(value: unknown): value is PlanGraphicElement {
  return (
    isRecord(value) &&
    typeof value.id === 'string' &&
    typeof value.kind === 'string' &&
    isPoint(value.pos) &&
    typeof value.width === 'number' &&
    typeof value.height === 'number'
  )
}

function sourceV1(element: ElementModelV2): unknown {
  return element.properties?.v1
}

function floorToV2(floor: Floor & Partial<FloorV2>): FloorV2 {
  const planAssetId = floor.planImportAsset?.id ?? floor.planAsset ?? floor.planAssetId
  const retainsCanonicalAsset = planAssetId != null && planAssetId === floor.planAssetId
  const processedPlanAssetId =
    (retainsCanonicalAsset ? floor.processedPlanAssetId : undefined) ??
    (floor.planImportAsset?.processedDataUrl ? `${floor.planImportAsset.id}-processed` : undefined) ??
    floor.planAssetProcessed ??
    floor.processedPlanAssetId
  return {
    id: floor.id,
    name: floor.name,
    planAssetId,
    processedPlanAssetId,
    scale: floor.scale,
    planScaleNeedsCalibration: floor.planScaleNeedsCalibration,
    planImageOffset: floor.planImageOffset,
    planImageRotationDeg: floor.planImageRotationDeg,
    planImageOpacity: floor.planImageOpacity,
    sitplanSymbolSizeCm: floor.sitplanSymbolSizeCm,
    hiddenSitplanElementIds: floor.hiddenSitplanPlacementIds,
  }
}

function resolvePlanImportAssetForV2Floor(
  v2Floor: FloorV2,
  document?: ProjectWithOptionalV2Building,
): ImportedPlanAsset | undefined {
  if (!v2Floor.planAssetId) return undefined

  const sourceAsset = document?.assets?.find((asset) => asset.id === v2Floor.planAssetId)
  const processedAsset = document?.assets?.find(
    (asset) => asset.id === v2Floor.processedPlanAssetId,
  )
  const sourceDataUrl =
    sourceAsset?.dataUrl && sourceAsset.dataUrl !== sourceAsset.id
      ? sourceAsset.dataUrl
      : undefined
  const processedDataUrl =
    processedAsset?.dataUrl && processedAsset.dataUrl !== processedAsset.id
      ? processedAsset.dataUrl
      : undefined
  const primaryAsset = sourceAsset ?? processedAsset
  const legacy = primaryAsset?.legacy

  return {
    ...(legacy ?? {
      id: v2Floor.planAssetId,
      kind:
        primaryAsset?.kind === 'floorplan-vector'
          ? 'pdf-vector'
          : primaryAsset?.kind === 'floorplan-processed'
            ? 'pdf-raster'
            : 'raster',
      width: primaryAsset?.width ?? processedAsset?.width ?? 0,
      height: primaryAsset?.height ?? processedAsset?.height ?? 0,
    }),
    id: v2Floor.planAssetId,
    sourceName: primaryAsset?.sourceName ?? legacy?.sourceName,
    pageIndex: primaryAsset?.pageIndex ?? legacy?.pageIndex,
    pageCount: primaryAsset?.pageCount ?? legacy?.pageCount,
    width: primaryAsset?.width ?? legacy?.width ?? processedAsset?.width ?? 0,
    height: primaryAsset?.height ?? legacy?.height ?? processedAsset?.height ?? 0,
    dataUrl: sourceDataUrl,
    processedDataUrl,
    svgContent: sourceAsset?.svgContent ?? legacy?.svgContent,
    crop: primaryAsset?.crop ?? legacy?.crop,
    darkModeAware: primaryAsset?.darkModeAware ?? legacy?.darkModeAware,
    grayscale: primaryAsset?.grayscale ?? legacy?.grayscale,
    cadReference: legacy?.cadReference,
  }
}

function floorV2ToCompatibility(
  floor: Floor | FloorV2,
  document?: ProjectWithOptionalV2Building
): Floor {
  if (
    'layers' in floor ||
    'floorPlan' in floor ||
    'planAsset' in floor ||
    'planAssetProcessed' in floor ||
    'planImportAsset' in floor
  ) {
    return floor as Floor
  }
  const v2Floor = floor as FloorV2
  const planImportAsset = resolvePlanImportAssetForV2Floor(v2Floor, document)

  const compatibilityFloor: Floor = {
    id: v2Floor.id,
    name: v2Floor.name,
    layers: ['electrical'],
    scale: v2Floor.scale,
    planScaleNeedsCalibration: v2Floor.planScaleNeedsCalibration,
    planAsset: planImportAsset?.dataUrl,
    planAssetProcessed: planImportAsset?.processedDataUrl,
    planImportAsset,
    planImageOffset: v2Floor.planImageOffset,
    planImageRotationDeg: v2Floor.planImageRotationDeg,
    planImageOpacity: v2Floor.planImageOpacity,
    sitplanSymbolSizeCm: v2Floor.sitplanSymbolSizeCm,
    hiddenSitplanPlacementIds: v2Floor.hiddenSitplanElementIds,
  }

  const floorPlan = document ? selectProjectFloorPlan(document, v2Floor.id) : undefined
  if (floorPlan) {
    compatibilityFloor.floorPlan = floorPlan
  }

  // Keep the canonical V2 floor fields on the same runtime object while exposing the
  // legacy-shaped editing properties needed by the remaining floor UI. This avoids a
  // second top-level `floors` owner during the vertical floor migration.
  return { ...v2Floor, ...compatibilityFloor } as Floor
}

function isFloorPlanAsset(asset: AssetModelV2): boolean {
  return (
    asset.kind === 'floorplan-source' ||
    asset.kind === 'floorplan-processed' ||
    asset.kind === 'floorplan-vector'
  )
}

function assetsFromFloor(floor: Floor): AssetModelV2[] {
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
    floor.planImportAsset?.processedDataUrl &&
    !assets.some((asset) => asset.id === `${floor.planImportAsset!.id}-processed`)
  ) {
    assets.push({
      id: `${floor.planImportAsset.id}-processed`,
      kind: 'floorplan-processed',
      dataUrl: floor.planImportAsset.processedDataUrl,
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
      (asset) =>
        asset.id === floor.planAssetProcessed || asset.dataUrl === floor.planAssetProcessed
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

function ensureAssets(document: ProjectWithOptionalV2Building): AssetModelV2[] {
  if (!Array.isArray(document.assets)) {
    document.assets = []
  }
  return document.assets
}

function ensureElements(document: ProjectWithOptionalV2Building): ElementModelV2[] {
  if (!Array.isArray(document.elements)) {
    document.elements = []
  }
  return document.elements
}

function ensureBuilding(document: ProjectWithOptionalV2Building): BuildingModelV2 {
  if (!document.building) {
    document.building = { floors: [] }
  }
  if (!Array.isArray(document.building.floors)) {
    document.building.floors = []
  }
  return document.building as BuildingModelV2
}

function clonePlanScale(scale: Floor['scale']): Floor['scale'] {
  if (!scale) return undefined
  return {
    pxPerMeter: scale.pxPerMeter,
    reference: scale.reference
      ? {
          p1: { ...scale.reference.p1 },
          p2: { ...scale.reference.p2 },
          meters: scale.reference.meters,
          ...(scale.reference.floorId ? { floorId: scale.reference.floorId } : {}),
          ...(scale.reference.coordinateSpace
            ? { coordinateSpace: scale.reference.coordinateSpace }
            : {}),
        }
      : undefined,
  }
}

/** Resolve the building-wide plan calibration, with old per-floor data as a fallback. */
export function selectProjectPlanScale(
  document: ProjectWithOptionalV2Building,
): Floor['scale'] {
  return document.building?.planScale ?? readLegacyCompatibilityFloors(document).find((floor) => floor.scale)?.scale
}

/** Store one calibration for the building and mirror it to every floor compatibility view. */
export function setPlanScaleForProject(
  document: ProjectWithOptionalV2Building,
  scale: Floor['scale'],
): void {
  const building = ensureBuilding(document)
  // A numeric-only import at the same units must not discard the owning floor's ruler.
  const next = scale && !scale.reference && building.planScale?.reference && resolvePlanPxPerMeter(scale) === resolvePlanPxPerMeter(building.planScale)
    ? { ...scale, reference: building.planScale.reference } : scale
  building.planScale = clonePlanScale(next)
  building.floors = building.floors.map((floor) => ({
    ...floor,
    scale: clonePlanScale(next),
  }))
}

/** Upgrade old per-floor calibration to the shared building setting during editor hydration. */
export function healSharedPlanScale(document: ProjectWithOptionalV2Building): boolean {
  const building = ensureBuilding(document)
  const sourceFloor = building.floors.find((floor) => floor.scale)
  let fallback = building.planScale ?? sourceFloor?.scale
  if (!fallback) return false

  const hasImportedPdfAsset = document.assets?.some(
    (asset) =>
      asset.sourceName?.toLowerCase().endsWith('.pdf') === true ||
      asset.legacy?.sourceName?.toLowerCase().endsWith('.pdf') === true,
  ) === true
  const legacyPdfImport =
    !!fallback.reference &&
    fallback.reference.coordinateSpace == null &&
    fallback.pxPerMeter != null &&
    hasImportedPdfAsset
  if (legacyPdfImport) {
    fallback = {
      pxPerMeter: fallback.pxPerMeter! / 2,
      reference: {
        p1: { x: fallback.reference!.p1.x / 2, y: fallback.reference!.p1.y / 2 },
        p2: { x: fallback.reference!.p2.x / 2, y: fallback.reference!.p2.y / 2 },
        meters: fallback.reference!.meters,
        coordinateSpace: 'asset',
      },
    }
  }

  const signature = JSON.stringify(fallback)
  const floorViews = compatibilityFloors(document)
  const needsHealing =
    legacyPdfImport ||
    JSON.stringify(building.planScale) !== signature ||
    building.floors.some((floor) => JSON.stringify(floor.scale) !== signature) ||
    floorViews.some((floor) => JSON.stringify(floor.scale) !== signature)
  if (!needsHealing) return false

  setPlanScaleForProject(document, fallback)
  return true
}

function layerIdFor(floorId: string | undefined, layerName: string): string {
  const normalized =
    layerName
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_') || 'layer'
  return floorId ? `layer_${floorId}_${normalized}` : `layer_${normalized}`
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

function elementsFromFloor(floor: Floor): ElementModelV2[] {
  const floorPlan = floor.floorPlan
  if (!floorPlan) return []

  const layerId = layerIdFor(floor.id, 'base-plan')
  const common = {
    floorId: floor.id,
    systemId: 'system_building',
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

function isBuildingElement(element: ElementModelV2): boolean {
  return element.kind.startsWith('building.')
}

function nativeFloorPlanFromBuildingElements(
  document: ProjectWithOptionalV2Building,
  floorId: string
): Floor['floorPlan'] | undefined {
  const sourceElements = document.elements
  // A newly assigned array inside an Immer producer can contain live drafts. Its
  // derived view is outside the state tree, so Immer will not finalize that view.
  const cacheable = !!sourceElements && Object.isFrozen(sourceElements)
  if (cacheable) {
    const cached = floorPlansByElements.get(sourceElements)?.get(floorId)
    if (cached !== undefined) return cached
  }
  const elements = sourceElements?.filter((element) => element.floorId === floorId) ?? []
  const walls: Wall[] = []
  const doors: Door[] = []
  const windows: Window[] = []
  const stairs: Stair[] = []
  const graphicElements: PlanGraphicElement[] = []
  let masterWallThickness: number | undefined

  for (const element of elements) {
    if (!isBuildingElement(element)) continue
    const v1 = sourceV1(element)

    if (element.kind === 'building.wall') {
      if (isWall(v1)) {
        walls.push(v1)
      } else if (element.geometry.kind === 'polyline') {
        walls.push({
          id: element.sourceRefs?.[0]?.id ?? element.id.replace(/^elem_wall_/, ''),
          floorId,
          points: element.geometry.points,
          curve: wallCurveFromProperties(element.properties?.curve),
        })
      }
      const properties = element.properties
      if (typeof properties?.masterWallThickness === 'number') {
        masterWallThickness = properties.masterWallThickness
      }
      continue
    }

    if (element.kind === 'building.door' || element.kind === 'building.opening') {
      if (isDoor(v1)) doors.push(v1)
      continue
    }

    if (element.kind === 'building.window') {
      if (isWindow(v1)) windows.push(v1)
      continue
    }

    if (element.kind === 'building.stair') {
      if (isStair(v1)) stairs.push(v1)
      continue
    }

    if (element.kind.startsWith('building.graphic.')) {
      if (isPlanGraphicElement(v1)) graphicElements.push(v1)
    }
  }

  if (
    walls.length === 0 &&
    doors.length === 0 &&
    windows.length === 0 &&
    stairs.length === 0 &&
    graphicElements.length === 0
  ) {
    return undefined
  }

  const floorPlan = {
    masterWallThickness: masterWallThickness ?? 20,
    walls,
    doors,
    windows,
    stairs,
    graphicElements,
  }
  if (cacheable) {
    let cache = floorPlansByElements.get(sourceElements)
    if (!cache) {
      cache = new Map()
      floorPlansByElements.set(sourceElements, cache)
    }
    cache.set(floorId, floorPlan)
  }
  return floorPlan
}

export function selectProjectFloorPlan(
  document: ProjectWithOptionalV2Building,
  floorId: string
): Floor['floorPlan'] | undefined {
  const nativeFloorPlan = nativeFloorPlanFromBuildingElements(document, floorId)
  if (nativeFloorPlan) return nativeFloorPlan
  return undefined
}

function compatibilityFloors(document: ProjectWithOptionalV2Building): Floor[] {
  const nativeFloors = document.building?.floors
  if (!nativeFloors) return []
  const cacheable =
    Object.isFrozen(nativeFloors) &&
    (document.assets === undefined || Object.isFrozen(document.assets)) &&
    (document.elements === undefined || Object.isFrozen(document.elements))
  if (cacheable) {
    const cached = compatibilityFloorsByNativeFloors.get(nativeFloors)
    if (cached && cached.assets === document.assets && cached.elements === document.elements) {
      return cached.floors
    }
  }
  const floors = nativeFloors.map((floor) => floorV2ToCompatibility(floor, document))
  if (cacheable) {
    compatibilityFloorsByNativeFloors.set(nativeFloors, {
      assets: document.assets,
      elements: document.elements,
      floors,
    })
  }
  return floors
}

export function replaceBuildingFloorsFromLegacyInput(
  document: ProjectWithOptionalV2Building,
  floors: readonly Floor[] = compatibilityFloors(document),
): void {
  const building = ensureBuilding(document)
  // Consume legacy-shaped geometry/assets before replacing the transitional floor objects with
  // their canonical V2 records.
  updateFloorPlanAssetsFromFloorViews(document, floors)
  updateBuildingElementsFromFloorViews(document, floors)
  building.floors = floors.map((floor) => ({
    ...floorToV2(floor),
    scale: clonePlanScale(building.planScale ?? floor.scale),
  }))
}

export function commitBuildingFloorView(
  document: ProjectWithOptionalV2Building,
  floorId: string,
  editedFloor?: Floor,
): void {
  const floor = editedFloor ?? compatibilityFloors(document).find(
    (candidate) => candidate.id === floorId,
  )
  if (!floor) return

  const building = ensureBuilding(document)
  const next = floorToV2(floor)
  if (building.planScale) next.scale = clonePlanScale(building.planScale)
  const index = building.floors.findIndex((candidate) => candidate.id === floorId)
  if (index === -1) {
    building.floors.push(next)
    return
  }
  building.floors[index] = {
    ...building.floors[index],
    ...next,
  }
  const floorViews = compatibilityFloors(document).map((candidate) =>
    candidate.id === floorId ? floor : candidate,
  )
  updateFloorPlanAssetsFromFloorViews(document, floorViews)
  updateBuildingElementsFromFloorViews(document, floorViews)
}

/**
 * Edit one projected floor view and immediately commit its canonical floor, assets, and elements.
 * The projected `Floor` never becomes part of `building.floors`.
 */
export function mutateBuildingFloorView(
  document: ProjectWithOptionalV2Building,
  floorId: string,
  mutate: (floor: Floor) => void,
): Floor | undefined {
  const floor = compatibilityFloors(document).find((candidate) => candidate.id === floorId)
  if (!floor) return undefined
  mutate(floor)
  commitBuildingFloorView(document, floorId, floor)
  return floor
}

/** Add a projected editor floor while storing only its canonical V2 representations. */
export function addBuildingFloorView(
  document: ProjectWithOptionalV2Building,
  floor: Floor,
): void {
  const building = ensureBuilding(document)
  const views = [...compatibilityFloors(document), floor]
  building.floors.push(floorToV2(floor))
  updateFloorPlanAssetsFromFloorViews(document, views)
  updateBuildingElementsFromFloorViews(document, views)
}

/**
 * Apply an atomic edit to all projected floor views, then replace their canonical representations.
 * Use this for reorder/delete operations that need the full ordered collection.
 */
export function mutateBuildingFloorViews(
  document: ProjectWithOptionalV2Building,
  mutate: (floors: Floor[]) => void,
): Floor[] {
  const floors = compatibilityFloors(document)
  mutate(floors)
  replaceBuildingFloorsFromLegacyInput(document, floors)
  return floors
}

export function removeBuildingFloor(document: ProjectWithOptionalV2Building, floorId: string): void {
  const building = ensureBuilding(document)
  building.floors = building.floors.filter((floor) => floor.id !== floorId)
  updateFloorPlanAssetsFromFloorViews(document)
  document.elements = ensureElements(document).filter(
    (element) => !(isBuildingElement(element) && element.floorId === floorId)
  )
}

function updateFloorPlanAssetsFromFloorViews(
  document: ProjectWithOptionalV2Building,
  floors: readonly Floor[] = compatibilityFloors(document),
): void {
  const referencedAssetIds = new Set(
    (document.building?.floors ?? []).flatMap((floor) =>
      [floor.planAssetId, floor.processedPlanAssetId].filter(
        (id): id is string => typeof id === 'string',
      ),
    ),
  )
  const derivedAssets = floors.flatMap(assetsFromFloor)
  const floorPlanAssetsById = new Map(
    ensureAssets(document)
      .filter(
        (asset) =>
          !isFloorPlanAsset(asset) ||
          referencedAssetIds.has(asset.id) ||
          !/^(?:data:|blob:|asset:)/.test(asset.id),
      )
      .map((asset) => [asset.id, asset] as const),
  )

  for (const asset of derivedAssets) {
    floorPlanAssetsById.set(asset.id, asset)
  }

  document.assets = [...floorPlanAssetsById.values()]
}

function updateBuildingElementsFromFloorViews(
  document: ProjectWithOptionalV2Building,
  floors: readonly Floor[] = compatibilityFloors(document),
): void {
  const nonBuildingElements = ensureElements(document).filter((element) => !isBuildingElement(element))
  const buildingElements = floors.flatMap(elementsFromFloor)
  document.elements = [...nonBuildingElements, ...buildingElements]
}

export function isProjectWithV2Building(
  document: ProjectWithCompatibilityBuilding
): document is ProjectWithCompatibilityBuilding & { building: BuildingModelV2 } {
  return Array.isArray((document as ProjectWithOptionalV2Building).building?.floors)
}

export function selectProjectBuildingFloorIds(document: ProjectWithOptionalV2Building): string[] {
  return selectProjectBuildingFloors(document).map((floor) => floor.id)
}

export function getBuildingFloorById(
  document: ProjectWithOptionalV2Building,
  floorId: string,
): FloorV2 | undefined {
  return document.building?.floors?.find((floor) => floor.id === floorId)
}

/** Resolve the persisted plan import asset for a native building floor. */
export function getPlanImportAssetForBuildingFloor(
  document: ProjectWithOptionalV2Building,
  floorId: string,
): ImportedPlanAsset | undefined {
  const v2Floor = getBuildingFloorById(document, floorId)
  if (!v2Floor) return undefined
  return resolvePlanImportAssetForV2Floor(v2Floor, document)
}

export function getCadReferenceForBuildingFloor(
  document: ProjectWithOptionalV2Building,
  floorId: string,
): CadReferenceV1 | undefined {
  return getPlanImportAssetForBuildingFloor(document, floorId)?.cadReference
}

export function selectProjectBuildingFloors(
  document: ProjectWithOptionalV2Building
): Array<Floor | FloorV2> {
  if (Array.isArray(document.building?.floors)) {
    return document.building.floors
  }
  return []
}

export function readLegacyCompatibilityFloors(
  document: ProjectWithOptionalV2Building
): Floor[] {
  return compatibilityFloors(document)
}

export function anonymizeFloorPlanSourcesForProject(document: ProjectWithOptionalV2Building): void {
  if (Array.isArray(document.building?.floors)) {
    document.building.floors = document.building.floors.map((floor, index) => ({
      ...floor,
      name: `Floor ${index + 1}`,
      planAssetId: undefined,
      processedPlanAssetId: undefined,
    }))
  }

  if (Array.isArray(document.assets)) {
    document.assets = document.assets.map((asset) => {
      if (!isFloorPlanAsset(asset)) return asset
      return {
        ...asset,
        sourceName: undefined,
        dataUrl: undefined,
        svgContent: undefined,
        legacy: undefined,
      }
    })
  }

  mutateBuildingFloorViews(document, (floors) => {
    for (const [index, floor] of floors.entries()) {
      const nextFloor = { ...floor }
      nextFloor.name = `Floor ${index + 1}`
      nextFloor.planAsset = undefined
      nextFloor.planAssetProcessed = undefined
      nextFloor.planImportAsset = undefined
      floors[index] = nextFloor
    }
  })
}
