import type {
  CableSpec,
  Floor,
  Frame,
  ImportedPlanAsset,
  Installation,
  Note,
  Panel,
  PlanWiringModel,
  Point2,
  ProjectMetadata,
  QuarantinedItem,
  WireSegment,
} from './schema'
import type { ViewportLayout } from './ui'
import type { AuxiliaryElectricalEnclosure, OffGridSupplyAssembly } from './supplyAssembly'

export const PROJECT_V2_SCHEMA_VERSION = '2.3.0' as const

export type ProjectV2SchemaVersion = typeof PROJECT_V2_SCHEMA_VERSION

export const PROJECT_SCOPE_IDS = {
  sharedBuilding: 'shared-building',
  electrical: 'electrical',
  coordination: 'coordination',
} as const

export type BuiltInProjectScopeId = (typeof PROJECT_SCOPE_IDS)[keyof typeof PROJECT_SCOPE_IDS]
export type ProjectScopeKindV2 = 'shared-building' | 'discipline' | 'coordination' | 'custom'
export type ProjectScopeLifecycleStatusV2 = 'active' | 'locked' | 'archived'

export interface ProjectScopeManifestEntryV2 {
  id: string
  kind: ProjectScopeKindV2
  discipline?: keyof DisciplineModelsV2 | 'custom'
  status: ProjectScopeLifecycleStatusV2
  systemIds: string[]
  layerIds: string[]
  viewIds: string[]
  assetIds: string[]
}

export interface ProjectCollaborationManifestV2 {
  version: number
  scopes: ProjectScopeManifestEntryV2[]
  /** Reserved compatibility data preserved without interpretation. */
  contributions?: Record<string, unknown>[]
}

export type ProjectScopeContributionV2 = Record<string, unknown>

/** Boundary used by storage adapters for native discipline payloads. */
export interface ProjectScopePayloadV2<TDocument = unknown> {
  scopeId: string
  kind: ProjectScopeKindV2
  discipline?: keyof DisciplineModelsV2 | 'custom'
  document: TDocument
}

export interface ProjectV2Meta {
  id: string
  name: string
  createdAt: string
  updatedAt: string
  /** Historical snapshot retained when this independent project was seeded from a cloud template. */
  origin?: ProjectTemplateOriginV2
  locale?: string
  yearOfConstruction?: number
  installDateColors?: ProjectMetadata['installDateColors']
  meterEanCode?: string
  lastActiveFloorId?: string
  lastActivePanelId?: string
  lastViewportLayout?: ViewportLayout
  planFloorOverlayVisibleByBaseFloorId?: Record<string, string[]>
  protectionCreationTemplates?: ProjectMetadata['protectionCreationTemplates']
  customer?: ProjectMetadata['customer']
  inspectionAgency?: ProjectMetadata['inspectionAgency']
  showInspectionAgencyInInfoBlock?: ProjectMetadata['showInspectionAgencyInInfoBlock']
  installerOverride?: ProjectMetadata['installerOverride']
  importSources?: ProjectMetadata['importSources']
}

export interface ProjectTemplateOriginV2 {
  kind: 'template'
  templateId: string
  templateName: string
  templateRevisionId: string
  seededAt: string
}

export type GeographicCrsV2 = 'EPSG:4326'

export interface GeoPointV2 {
  latitude: number
  longitude: number
  altitudeM?: number
  crs: GeographicCrsV2
}

export interface GeoPolygonV2 {
  crs: GeographicCrsV2
  points: GeoPointV2[]
}

export type GeocodingProviderV2 = 'google' | 'mapbox' | 'geoapify' | 'osm' | 'manual' | 'custom'

export type GeocodingAccuracyV2 = 'rooftop' | 'parcel' | 'street' | 'city' | 'manual'

export interface SiteGeocodingV2 {
  provider: GeocodingProviderV2
  providerPlaceId?: string
  resolvedAt: string
  formattedAddress?: string
  confidence?: number
  accuracy?: GeocodingAccuracyV2
}

export interface ParcelV2 {
  id: string
  source?: string
  geometry: GeoPolygonV2
  properties?: Record<string, unknown>
}

export interface MapAlignmentV2 {
  provider?: GeocodingProviderV2
  mapType?: 'roadmap' | 'satellite' | 'hybrid' | 'terrain' | 'custom'
  center?: GeoPointV2
  zoom?: number
  bearingDeg?: number
  pitchDeg?: number
  capturedAt?: string
}

export interface SiteModelV2 {
  address?: Installation['address']
  geocoding?: SiteGeocodingV2
  location?: GeoPointV2
  parcels?: ParcelV2[]
  mapAlignment?: MapAlignmentV2
}

export interface BuildingModelV2 {
  id?: string
  name?: string
  /** Shared plan calibration used by every floor in the building. */
  planScale?: Floor['scale']
  floors: FloorV2[]
  spaces?: SpaceV2[]
  footprint?: BuildingFootprintV2
  georeference?: BuildingGeoreferenceV2
}

export interface BuildingFootprintV2 {
  geometry: GeoPolygonV2
  source?: 'manual' | 'map' | 'cad' | 'government-data' | 'import'
}

export interface BuildingGeoreferenceControlPointV2 {
  id: string
  local: Point2
  geo: GeoPointV2
  label?: string
}

export interface BuildingGeoreferenceV2 {
  crs: GeographicCrsV2
  method: 'origin-rotation-scale' | 'control-points'
  origin: {
    local: Point2
    geo: GeoPointV2
  }
  trueNorthDeg: number
  scale: {
    metersPerCanvasUnit: number
  }
  controlPoints?: BuildingGeoreferenceControlPointV2[]
}

export interface FloorV2 {
  id: string
  name: string
  elevationMm?: number
  heightMm?: number
  planAssetId?: string
  processedPlanAssetId?: string
  scale?: Floor['scale']
  planScaleNeedsCalibration?: boolean
  planImageOffset?: Point2
  planImageRotationDeg?: number
  planImageOpacity?: number
  sitplanSymbolSizeCm?: number
  hiddenSitplanElementIds?: string[]
  georeferenceOverride?: BuildingGeoreferenceV2
}

export interface SpaceV2 {
  id: string
  floorId: string
  name?: string
  geometryElementId?: string
}

export type SystemKindV2 =
  | 'building'
  | 'electrical'
  | 'telecom'
  | 'data-network'
  | 'cold-water'
  | 'hot-water'
  | 'wastewater'
  | 'heating'
  | 'hvac'
  | 'gas'
  | 'solar'
  | 'security'
  | 'annotation'
  | 'custom'

export interface SystemModelV2 {
  id: string
  scopeId?: string
  kind: SystemKindV2
  name: string
}

export type LayerKindV2 =
  | 'base-plan'
  | 'annotation'
  | 'building'
  | 'electrical'
  | 'telecom'
  | 'sanitary'
  | 'heating'
  | 'hvac'
  | 'custom'

export interface LayerModelV2 {
  id: string
  scopeId?: string
  name: string
  kind: LayerKindV2
  systemId?: string
  floorId?: string
  color?: string
  visibleByDefault?: boolean
  locked?: boolean
  exportable?: boolean
  /** Optional construction/renovation phase represented by a chronology event. */
  chronologyEventId?: string
  /** Visual role inside a phase; does not grant edit authority. */
  phaseRole?: 'existing' | 'demolition' | 'new' | 'temporary'
}

export type GeometryModelV2 =
  | {
      kind: 'point'
      position: Point2
      rotationDeg?: number
      scale?: number
      zMm?: number
    }
  | {
      kind: 'polyline'
      points: Point2[]
      zStartMm?: number
      zEndMm?: number
    }
  | {
      kind: 'polygon'
      points: Point2[]
      zMm?: number
    }
  | {
      kind: 'rect'
      position: Point2
      width: number
      height: number
      rotationDeg?: number
      zMm?: number
    }

export interface ClassificationV2 {
  eendraKind?: string
  ifcType?: string
  customType?: string
}

export interface SourceReferenceV2 {
  kind: 'v1' | 'import' | 'external'
  id: string
  path?: string
}

export interface ElementModelV2 {
  id: string
  scopeId?: string
  kind: string
  name?: string
  floorId?: string
  spaceId?: string
  systemId?: string
  layerId?: string
  geometry: GeometryModelV2
  properties?: Record<string, unknown>
  classification?: ClassificationV2
  sourceRefs?: SourceReferenceV2[]
  createdAt?: string
  updatedAt?: string
  introducedByEventId?: string
  retiredByEventId?: string
}

export type RelationshipKindV2 =
  | 'contains'
  | 'hosts'
  | 'electrical-circuit'
  | 'control'
  | 'data-link'
  | 'pipe-flow'
  | 'duct-flow'
  | 'supply-return'
  | 'feeds'
  | 'replaces'
  | 'splits-into'
  | 'merges-into'
  | 'legacy-ref'
  | 'custom'

export interface RelationshipModelV2 {
  id: string
  scopeId?: string
  kind: RelationshipKindV2
  fromElementId: string
  toElementId: string
  systemId?: string
  properties?: Record<string, unknown>
}

export type ViewKindV2 = 'floor-plan' | 'one-wire' | 'panel-board' | 'export-sheet'

export interface ViewModelV2 {
  id: string
  scopeId?: string
  kind: ViewKindV2
  name: string
  floorId?: string
  panelId?: string
  visibleLayerIds?: string[]
  hiddenElementIds?: string[]
  camera?: {
    zoom: number
    pan: Point2
  }
}

export type AssetKindV2 =
  | 'floorplan-source'
  | 'floorplan-processed'
  | 'floorplan-vector'
  | 'installer-logo'
  | 'installer-signature'
  | 'import-source'
  | 'document'
  | 'other'

/**
 * Metadata of an attached project document (`kind: 'document'`). A document either carries its
 * own payload in `dataUrl`, or annotates another project asset named by `sourceAssetId`.
 */
/** One row of a generated external influences table (AREI Book 1, 2.10). */
export interface ExternalInfluenceRoomV2 {
  id: string
  name: string
  /** Selected class numbers per two-letter parameter code (e.g. `AD: [4]`, `AL: [1, 2]`). */
  classes: Record<string, number[]>
  publiclyAccessible: boolean
}

export interface ProjectDocumentMetadataV2 {
  name?: string
  category?: string
  includeInExport?: boolean
  /** 1-based pages that go along with the export; all pages when absent. */
  exportPages?: number[]
  links?: Array<{ type: string; id: string; label?: string }>
  addedAt?: string
  sourceAssetId?: string
  /** Hosted team projects: the team library document this upload was copied from. */
  teamDocumentId?: string
  /** A table created in the editor; such a document has no file payload. */
  externalInfluences?: { rooms: ExternalInfluenceRoomV2[] }
  /**
   * Settings of a document every project derives live (the cable schedule); such an entry has
   * no payload and only carries the export choice.
   */
  builtIn?: 'cableSchedule'
}

export interface AssetModelV2 {
  id: string
  /** Floor-plan assets are shared-building by definition; other assets declare their scope here. */
  scopeId?: string
  kind: AssetKindV2
  sourceName?: string
  mimeType?: string
  dataUrl?: string
  svgContent?: string
  width?: number
  height?: number
  pageIndex?: number
  pageCount?: number
  crop?: ImportedPlanAsset['crop']
  darkModeAware?: boolean
  /** Vector floor plans: draw in greyscale; `svgContent` keeps its colours. */
  grayscale?: boolean
  sizeBytes?: number
  document?: ProjectDocumentMetadataV2
  legacy?: ImportedPlanAsset
}

export interface ElectricalDeviceV2 {
  id: string
  elementIds: string[]
  legacyEndpointId: string
  circuitId?: string
  panelId?: string
  symbol?: string
  type: string
  properties?: Record<string, unknown>
}

export interface OneWireModelV2 {
  notes?: Note[]
  frames?: Frame[]
  wireSegments?: WireSegment[]
}

/** Canonical function of a single conductor (core) in a {@link WireRun}. */
export type WireConductorFunction = 'L1' | 'L2' | 'L3' | 'N' | 'PE'

/**
 * One conductor (core) of a wire run. Kept as a list rather than a scalar count so the endgame
 * per-conductor model (colour, per-core section, later terminal identity) can grow without a
 * reshape. The default set is derived from the branch phase shape (poles-aware); a manual edit
 * sets {@link WireRun.conductorsOverridden}.
 */
export interface WireConductor {
  function: WireConductorFunction
  /** Optional per-core section override in mm²; falls back to {@link WireRun.cable}.sectionMm2. */
  sectionMm2?: number
}

/**
 * Canonical per-edge wire entity (Goal 19 / ADR-0002). A run holds the shared cable spec and
 * conductor model; {@link WireRun.members} lists the relationship ids that share it, and length is
 * stored per member edge. A run is edge-borne: it is referenced from electrical path relationships
 * via `relationship.properties.wireRef` and is never projected as a graph node.
 */
export interface WireRun {
  id: string
  /**
   * Stable canonical anchor keys of the edges sharing this run (the link/unlink primitive; length
   * is per member). Anchors — not volatile relationship ids — so a run survives graph re-derivation;
   * see `deriveWireAnchorKey` in `lib/projectV2/wireRuns`. `builder.ts` computes the same key per
   * edge and stamps `relationship.properties.wireRef`. An edge whose anchor matches no run falls
   * back to a default wire rather than orphaning.
   */
  members: string[]
  /** Shared cable spec: kind / sectionMm2 / fireClass / hasPE. */
  cable: CableSpec
  /**
   * True when `cable.kind` was never chosen for this AC circuit run and follows
   * `Installation.defaultCableKind`; the rest of `cable` stays authored. Missing = authored kind.
   */
  followsDefaultCable?: boolean
  /** Shared conductor model, default-derived from the branch phase shape, overridable. */
  conductors: WireConductor[]
  /** True when conductors were set manually and must survive a system/phase change unchanged. */
  conductorsOverridden?: boolean
  /**
   * Physical medium of the run (Goal 19). `'busbar'` = a shared solid bar whose copper thickness is
   * carried in {@link WireRun.cable}.sectionMm2 and whose bars-per-phase are its conductors;
   * `'cable'` = individual conductors. Default `'cable'`. A bus is modelled as one shared busbar run
   * whose members are its tap edges; forking a tap unlinks it into its own run and flips it to
   * `'cable'`. Independent of whether the one-wire *draws* a bus rail.
   */
  medium?: 'cable' | 'busbar'
  /** Conductor material, relevant mainly for busbars. Default copper. */
  material?: 'copper' | 'aluminium'
  /**
   * For a busbar run, how each tap's length is accounted: `'from-feeder'` (star — measured back to
   * the feed point) or `'chained'` (each tap ≈ its neighbour spacing). Affects only per-member
   * `segmentLengths`, not topology; the difference is typically 30–50 cm.
   */
  busTapLengthMode?: 'from-feeder' | 'chained'
  /** `'wall'` is in the wall; `'on-wall'` is surface-mounted on it. */
  route?: 'wall' | 'on-wall' | 'ground' | 'air'
  inTube?: boolean
  /** Per-member-edge run length in metres, keyed by the same anchor keys as {@link WireRun.members}. */
  segmentLengths?: Record<string, number>
  /**
   * Provenance of {@link WireRun.segmentLengths}, keyed the same way. `'estimated'` marks a length
   * accepted from the plan-based route estimate; 'estimated-stale' requires review after a
   * calibration change and carries no numerical length. A missing entry means the user entered it.
   */
  segmentLengthSources?: Record<string, 'estimated' | 'estimated-stale'>
  labels?: {
    hideWireLabel?: boolean
    showFireClassLabel?: boolean
    showWireLengthLabel?: boolean
  }
}

export interface ElectricalModelV2 {
  installation: Installation
  panels: Panel[]
  devices: ElectricalDeviceV2[]
  planWiring?: PlanWiringModel
  oneWire: OneWireModelV2
  /** Optional so projects created before the supply workspace remain valid and unchanged. */
  supplyAssemblies?: OffGridSupplyAssembly[]
  auxiliaryEnclosures?: AuxiliaryElectricalEnclosure[]
  /**
   * Canonical per-edge wire runs (Goal 19 / ADR-0002). Optional during the transition: absent on
   * projects written before `2.2.0`; the `2.2.0` migration seeds it best-effort from
   * `Circuit.sectionWireOverrides`, `FeedTopology.wireSections`, and `SupplyConnection.wireProperties`
   * (unmapped legacy data falls back to a default wire rather than blocking the migration). The
   * `2.3.0` migration repairs the routes that seed lost (on-wall vs. in-wall).
   */
  wireRuns?: WireRun[]
}

export interface DisciplineModelsV2 {
  electrical?: ElectricalModelV2
  telecom?: Record<string, unknown>
  sanitary?: Record<string, unknown>
  heating?: Record<string, unknown>
  hvac?: Record<string, unknown>
}

export interface ValidationStateV2 {
  lastValidatedAt?: string
  quarantinedItems?: QuarantinedItem[]
}

export type ChronologyDateGranularityV2 = 'year' | 'month' | 'day' | 'instant'

export type ChronologyEventKindV2 =
  | 'creation'
  | 'renovation'
  | 'extension'
  | 'inspection'
  | 'version'
  | 'import'
  | 'custom'

export type ChronologySourceV2 = 'manual' | 'version' | 'import' | 'reconstructed'

export type ChronologyAssignmentRoleV2 = 'added' | 'changed' | 'removed' | 'exists-at'

export interface ChronologyEntityRefV2 {
  system?: SystemKindV2
  discipline?: keyof DisciplineModelsV2 | 'custom'
  type: string
  id: string
}

export interface ChronologyEventV2 {
  id: string
  date: string
  granularity: ChronologyDateGranularityV2
  kind: ChronologyEventKindV2
  label?: string
  source: ChronologySourceV2
  versionId?: string
  savedAt?: string
  metadata?: Record<string, unknown>
}

export interface ChronologyAssignmentV2 {
  id: string
  eventId: string
  entityRef: ChronologyEntityRefV2
  role: ChronologyAssignmentRoleV2
  source: 'manual' | 'version-diff' | 'inferred' | 'import'
  locked?: boolean
  metadata?: Record<string, unknown>
  /** Optional geometry/property evidence for offline historical and demolition views. */
  snapshot?: {
    before?: ElementModelV2
    after?: ElementModelV2
  }
}

export interface ChronologyModelV2 {
  version: 1
  events: ChronologyEventV2[]
  assignments: ChronologyAssignmentV2[]
}

export type CommentCanvasKindV2 = ViewKindV2 | 'custom'

/** Reserved compatibility data preserved without interpretation. */
export type CommentModelV2 = Record<string, unknown>

export interface ProjectV2 {
  schemaVersion: ProjectV2SchemaVersion
  collaboration: ProjectCollaborationManifestV2
  project: ProjectV2Meta
  site?: SiteModelV2
  building: BuildingModelV2
  systems: SystemModelV2[]
  layers: LayerModelV2[]
  elements: ElementModelV2[]
  relationships: RelationshipModelV2[]
  views: ViewModelV2[]
  assets: AssetModelV2[]
  disciplines: DisciplineModelsV2
  comments: CommentModelV2
  chronology: ChronologyModelV2
  validation?: ValidationStateV2
}
