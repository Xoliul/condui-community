import type { AssetModelV2, ProjectDocumentMetadataV2 } from '@/types/projectV2'
import {
  isProjectDocumentAsset,
  PROJECT_DOCUMENT_ASSET_KIND,
} from '@/lib/projectV2/documentAssets'
import {
  floorPlanImportKey,
  getFloorPlanImportAssetIds,
  getFloorsShowingPlanAssets,
} from '@/lib/projectV2/floorPlanAssets'

/** Display order of document groups in the Documents canvas and export annex. */
export const PROJECT_DOCUMENT_CATEGORIES = [
  'inspection',
  'datasheet',
  'sourcePlan',
  'schematic',
  'other',
] as const

export type ProjectDocumentCategory = (typeof PROJECT_DOCUMENT_CATEGORIES)[number]

/** File documents the viewer renders; generated documents render their own editor. */
export type ProjectFileKind = 'pdf' | 'image'
export type ProjectDocumentKind =
  | ProjectFileKind
  | 'externalInfluences'
  | 'cableSchedule'
  | 'controlAddresses'
  | 'junctionOverview'

/**
 * `projectAsset` documents are derived from files the project already owns and are read-only;
 * `generated` documents are created and edited in Condui (no file behind them); `builtIn`
 * documents are views every project has, derived live from the project and never stored.
 */
export type ProjectDocumentOrigin = 'upload' | 'projectAsset' | 'generated' | 'builtIn'

export const CABLE_SCHEDULE_DOCUMENT_ID = 'builtin:cable-schedule'
/** Stores the cable schedule's export choice; the schedule itself is never stored. */
export const CABLE_SCHEDULE_SETTINGS_ASSET_ID = 'document-builtin-cable-schedule'

export const CONTROL_ADDRESSES_DOCUMENT_ID = 'builtin:control-addresses'
/** Stores the domotica address table's export choice; the table itself is never stored. */
export const CONTROL_ADDRESSES_SETTINGS_ASSET_ID = 'document-builtin-control-addresses'

/**
 * The domotica address table: a live list of every domotica module with its channels. Listed
 * only in projects with domotica modules, and kept out of exports until chosen.
 */
export function controlAddressesDocument(
  name: string,
  assets?: readonly AssetModelV2[] | null
): ProjectDocument {
  const settings = assets?.find((asset) => asset.id === CONTROL_ADDRESSES_SETTINGS_ASSET_ID)
  return {
    id: CONTROL_ADDRESSES_DOCUMENT_ID,
    name,
    category: 'schematic',
    kind: 'controlAddresses',
    mimeType: '',
    url: '',
    origin: 'builtIn',
    visibleToViewers: false,
    includeInExport: settings?.document?.includeInExport ?? false,
    links: [],
    addedAt: '',
  }
}

/**
 * The always-present cable schedule: a live list of every cable in the project. It stays out of
 * exports until chosen.
 */
export function cableScheduleDocument(
  name: string,
  assets?: readonly AssetModelV2[] | null
): ProjectDocument {
  const settings = assets?.find((asset) => asset.id === CABLE_SCHEDULE_SETTINGS_ASSET_ID)
  return {
    id: CABLE_SCHEDULE_DOCUMENT_ID,
    name,
    category: 'schematic',
    kind: 'cableSchedule',
    mimeType: '',
    url: '',
    origin: 'builtIn',
    visibleToViewers: false,
    includeInExport: settings?.document?.includeInExport ?? false,
    links: [],
    addedAt: '',
  }
}

/** A selectable editor element (selection type + id) a document is attached to. */
export interface ProjectDocumentLink {
  type: string
  id: string
  /** Element title captured when linking, shown in the document details. */
  label?: string
}

export interface ProjectDocument {
  id: string
  name: string
  category: ProjectDocumentCategory
  kind: ProjectDocumentKind
  mimeType: string
  /** Object URL or data URL the viewer can load; empty for generated documents. */
  url: string
  origin: ProjectDocumentOrigin
  /**
   * For project-asset documents: the floor plan placed on the situation plan (already part of
   * the export as a drawing) or an imported diagram's original file.
   */
  sourceKind?: 'floorPlan' | 'importSource'
  /**
   * Read-only viewers (QR scans, team and project viewers, contributors) can open it: uploads
   * linked to a device and floor plans placed on a floor. Mirrors the server's QR-share filter.
   */
  visibleToViewers: boolean
  includeInExport: boolean
  /** 1-based pages included in the export; all pages when absent. Kept while excluded. */
  exportPages?: number[]
  links: ProjectDocumentLink[]
  sizeBytes?: number
  addedAt: string
  /** Copied from the team library (hosted team projects). */
  teamDocumentId?: string
}

export interface ProjectDocumentGroup {
  category: ProjectDocumentCategory
  documents: ProjectDocument[]
}

const IMAGE_MIME_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml'])

/** Only PDFs and images are accepted: both can be viewed in-app and merged into a PDF export. */
export function getProjectDocumentKind(mimeType: string, fileName = ''): ProjectFileKind | null {
  const mime = mimeType.trim().toLowerCase()
  if (mime === 'application/pdf' || (!mime && /\.pdf$/i.test(fileName))) return 'pdf'
  if (IMAGE_MIME_TYPES.has(mime)) return 'image'
  if (!mime && /\.(png|jpe?g|webp|svg)$/i.test(fileName)) return 'image'
  return null
}

/**
 * Bodies accredited for AREI inspections in Belgium (FOD Economie list), as they appear in report
 * file names. Short acronyms only match as whole words.
 */
const INSPECTION_BODIES =
  /\baca\b|\baceg\b|\bacmv\b|apave|apragaz|\bascon\b|atecon|atenas|\batk\b|a t k\b|atlas controle|belgateq|belgotest|\bbelor\b|be r1ght|beright|\bbti\b|certigreen|certinergie|e ctrl|\bectrl|enercetec|house ?check|\bkea\b|keurteam|keurtech|normec|\bbtv\b|\bocb\b|o c b\b|procontrol|seco belgium|\bsgs\b|smart control|socotec|sofistes|vastgoedexpert|van hemelen|vincotte|electro ?test/

/** Checked in order: a device's declaration of conformity is documentation, not an inspection. */
const CATEGORY_NAME_PATTERNS: Array<[ProjectDocumentCategory, RegExp]> = [
  [
    'datasheet',
    /conformiteitsverklaring|verklaring van overeenstemming|declaration (of|de) conformit|\bce (verklaring|declaration|markering|marking)/,
  ],
  [
    'inspection',
    /keuring|gekeurd|inspect|verslag|rapport|report|controle|\bpv\b|proces verbaal|attest|conformit|gelijkvormig|visite de contr/,
  ],
  ['inspection', INSPECTION_BODIES],
  [
    'datasheet',
    /data ?sheet|datenblatt|fiche|spec|manual|handleiding|gebruiksaanwijzing|mode d emploi|notice|certificat|certificaat|garantie|warranty|brochure/,
  ],
  ['schematic', /schema|eendraad|single ?line|unifilaire/],
  ['sourcePlan', /plan|grondplan|floor|situatie/],
]

/** Lower case without accents; separators read as spaces, the extension dropped. */
function normalizeDocumentName(fileName: string): string {
  return fileName
    .replace(/\.[a-z0-9]+$/i, '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[_\-.]+/g, ' ')
}

/** Best-effort category from a file name; the user can always move it. */
export function guessProjectDocumentCategory(fileName: string): ProjectDocumentCategory {
  const name = normalizeDocumentName(fileName)
  for (const [category, pattern] of CATEGORY_NAME_PATTERNS) {
    if (pattern.test(name)) return category
  }
  return 'other'
}

function mimeTypeFromDataUrl(dataUrl: string): string {
  const match = /^data:([^;,]+)/i.exec(dataUrl)
  return match?.[1]?.toLowerCase() ?? ''
}

const FLOOR_PLAN_ASSET_PREFERENCE: Partial<Record<AssetModelV2['kind'], number>> = {
  'floorplan-source': 0,
  'floorplan-processed': 1,
  'floorplan-vector': 2,
}

function assetDocumentUrl(asset: AssetModelV2): { url: string; mimeType: string } | null {
  if (asset.dataUrl?.startsWith('data:')) {
    return { url: asset.dataUrl, mimeType: asset.mimeType ?? mimeTypeFromDataUrl(asset.dataUrl) }
  }
  if (asset.svgContent) {
    return {
      url: `data:image/svg+xml;charset=utf-8,${encodeURIComponent(asset.svgContent)}`,
      mimeType: 'image/svg+xml',
    }
  }
  return null
}

/** Documents derived from another project asset use this id; uploads use their asset id. */
const DERIVED_DOCUMENT_ID_PREFIX = 'asset:'
const DOCUMENT_OVERLAY_ASSET_ID_PREFIX = 'document-overlay-'

/**
 * Largest file accepted for processing; it must still fit the project budget once optimized.
 * Matches the per-file limit of the portable project importer.
 */
export const MAX_PROJECT_DOCUMENT_BYTES = 100 * 1024 * 1024

/**
 * Storage budget for uploaded documents per project. Large photos are optimized on upload and
 * PDFs can be reduced, so a project's datasheets and reports fit comfortably.
 */
export const PROJECT_DOCUMENTS_STORAGE_LIMIT_BYTES = 20 * 1000 * 1000

/** Bytes a document occupies; data URL payloads are measured when no size was recorded. */
export function getProjectDocumentSizeBytes(document: Pick<ProjectDocument, 'sizeBytes' | 'url'>): number {
  if (document.sizeBytes !== undefined) return document.sizeBytes
  const comma = document.url.indexOf(',')
  if (comma < 0) return 0
  const payload = document.url.length - comma - 1
  return /;base64,/i.test(document.url.slice(0, comma + 1))
    ? Math.floor((payload * 3) / 4)
    : payload
}

/** Storage used by uploaded documents, which count against the project budget. */
export function getProjectDocumentsStorageBytes(documents: readonly ProjectDocument[]): number {
  return documents
    .filter((document) => document.origin === 'upload')
    .reduce((total, document) => total + getProjectDocumentSizeBytes(document), 0)
}

/** Pages of a document that go along with the export, given its page count. */
export function getExportedDocumentPages(
  document: Pick<ProjectDocument, 'includeInExport' | 'exportPages'>,
  pageCount: number
): number[] {
  if (!document.includeInExport) return []
  const all = Array.from({ length: pageCount }, (_, index) => index + 1)
  if (!document.exportPages) return all
  return document.exportPages.filter((page) => page >= 1 && page <= pageCount)
}

/**
 * Includes or excludes one page. Selecting a page of an excluded document includes just that
 * page; deselecting the last page excludes the document; selecting every page clears the list.
 */
export function toggleProjectDocumentExportPage(
  document: Pick<ProjectDocument, 'includeInExport' | 'exportPages'>,
  page: number,
  pageCount: number
): { includeInExport: boolean; exportPages: number[] | undefined } {
  const current = new Set(getExportedDocumentPages(document, pageCount))
  if (current.has(page)) current.delete(page)
  else current.add(page)
  const pages = [...current].sort((a, b) => a - b)
  if (pages.length === 0) return { includeInExport: false, exportPages: undefined }
  return { includeInExport: true, exportPages: pages.length === pageCount ? undefined : pages }
}

/** The page selection after deleting `deletedPage` from the file: later pages move up. */
export function exportPagesAfterPageDeletion(
  exportPages: readonly number[] | undefined,
  deletedPage: number,
  remainingPageCount: number
): number[] | undefined {
  return exportPagesAfterPagesDeletion(exportPages, [deletedPage], remainingPageCount)
}

/** Same for several deleted pages at once: survivors are renumbered past every removed page. */
export function exportPagesAfterPagesDeletion(
  exportPages: readonly number[] | undefined,
  deletedPages: readonly number[],
  remainingPageCount: number
): number[] | undefined {
  if (!exportPages) return undefined
  const deleted = new Set(deletedPages)
  const pages = exportPages
    .filter((page) => !deleted.has(page))
    .map((page) => page - deletedPages.filter((removed) => removed < page).length)
  // A selection that now covers every page is the same as "all pages".
  return pages.length >= remainingPageCount ? undefined : pages
}

/** Editable fields. Documents derived from project files accept all but the name. */
export type ProjectDocumentPatch = Partial<
  Pick<
    ProjectDocument,
    'name' | 'category' | 'includeInExport' | 'exportPages' | 'links' | 'teamDocumentId'
  >
>

function isProjectDocumentCategory(value: unknown): value is ProjectDocumentCategory {
  return (PROJECT_DOCUMENT_CATEGORIES as readonly unknown[]).includes(value)
}

function applyDocumentMetadata(
  document: ProjectDocument,
  metadata: ProjectDocumentMetadataV2 | undefined
): ProjectDocument {
  if (!metadata) return document
  return {
    ...document,
    name: metadata.name || document.name,
    category: isProjectDocumentCategory(metadata.category) ? metadata.category : document.category,
    // Documents stay out of exports until chosen, or until linked to a device, which gives them
    // a purpose there.
    includeInExport:
      metadata.includeInExport ?? ((metadata.links?.length ?? 0) > 0 || document.includeInExport),
    exportPages: metadata.exportPages ?? document.exportPages,
    links: metadata.links ?? document.links,
    addedAt: metadata.addedAt || document.addedAt,
    ...(metadata.teamDocumentId ? { teamDocumentId: metadata.teamDocumentId } : {}),
  }
}

/** A table created in the editor; stored as document metadata without a file. */
function generatedDocumentFromAsset(
  asset: AssetModelV2,
  fallbackAddedAt: string
): ProjectDocument {
  return applyDocumentMetadata(
    {
      id: asset.id,
      name: asset.document?.name ?? '',
      category: 'inspection',
      kind: 'externalInfluences',
      mimeType: '',
      url: '',
      origin: 'generated',
      visibleToViewers: false,
      // A table exists to go along with the PDF; the user can still leave it out.
      includeInExport: true,
      links: [],
      addedAt: fallbackAddedAt,
    },
    asset.document
  )
}

function uploadedDocumentFromAsset(
  asset: AssetModelV2,
  fallbackAddedAt: string
): ProjectDocument | null {
  if (!asset.dataUrl?.startsWith('data:')) return null
  const mimeType = asset.mimeType ?? mimeTypeFromDataUrl(asset.dataUrl)
  const name = asset.document?.name || asset.sourceName || ''
  const kind = getProjectDocumentKind(mimeType, name)
  if (!kind) return null
  const document = applyDocumentMetadata(
    {
      id: asset.id,
      name,
      category: guessProjectDocumentCategory(name),
      kind,
      mimeType,
      url: asset.dataUrl,
      origin: 'upload',
      visibleToViewers: false,
      includeInExport: false,
      links: [],
      sizeBytes: asset.sizeBytes,
      addedAt: fallbackAddedAt,
    },
    asset.document
  )
  return { ...document, visibleToViewers: document.links.length > 0 }
}

/**
 * All documents of a project: read-only documents derived from files the project already stores
 * (the original floor-plan imports, preferring the untouched source, and imported diagram
 * sources), followed by uploads and tables created in the editor. Persisted edits of derived
 * documents are applied.
 */
export function getProjectDocuments(
  assets: readonly AssetModelV2[] | null | undefined,
  addedAt = '',
  floors: ReadonlyArray<{ planAssetId?: string; processedPlanAssetId?: string }> = []
): ProjectDocument[] {
  if (!assets) return []
  const placedAssetIds = new Set(
    floors.flatMap((floor) =>
      [floor.planAssetId, floor.processedPlanAssetId].filter(
        (id): id is string => typeof id === 'string'
      )
    )
  )
  const placedImportKeys = new Set(
    assets
      .filter((asset) => placedAssetIds.has(asset.id) && FLOOR_PLAN_ASSET_PREFERENCE[asset.kind] !== undefined)
      .map(floorPlanImportKey)
  )
  const floorPlanByImport = new Map<string, AssetModelV2>()
  const derivedMetadataBySourceId = new Map<string, ProjectDocumentMetadataV2>()
  const documents: ProjectDocument[] = []
  /** Uploads and tables created in the editor, in the order they were added. */
  const userDocuments: ProjectDocument[] = []

  for (const asset of assets) {
    if (isProjectDocumentAsset(asset)) {
      const sourceAssetId = asset.document?.sourceAssetId
      if (asset.document?.builtIn) {
        // Settings of a derived view, read by that view.
      } else if (sourceAssetId) {
        derivedMetadataBySourceId.set(sourceAssetId, asset.document ?? {})
      } else if (asset.document?.externalInfluences) {
        userDocuments.push(generatedDocumentFromAsset(asset, addedAt))
      } else {
        const upload = uploadedDocumentFromAsset(asset, addedAt)
        if (upload) userDocuments.push(upload)
      }
      continue
    }
    const preference = FLOOR_PLAN_ASSET_PREFERENCE[asset.kind]
    if (preference === undefined) continue
    if (!assetDocumentUrl(asset)) continue
    const key = floorPlanImportKey(asset)
    const current = floorPlanByImport.get(key)
    if (!current || preference < (FLOOR_PLAN_ASSET_PREFERENCE[current.kind] ?? Infinity)) {
      floorPlanByImport.set(key, asset)
    }
  }

  const pushAssetDocument = (
    asset: AssetModelV2,
    category: ProjectDocumentCategory,
    sourceKind: NonNullable<ProjectDocument['sourceKind']>
  ) => {
    const source = assetDocumentUrl(asset)
    if (!source) return
    const kind = getProjectDocumentKind(source.mimeType)
    if (!kind) return
    const pageSuffix =
      asset.pageCount && asset.pageCount > 1 && asset.pageIndex !== undefined
        ? ` (${asset.pageIndex + 1}/${asset.pageCount})`
        : ''
    const document: ProjectDocument = {
      id: `${DERIVED_DOCUMENT_ID_PREFIX}${asset.id}`,
      name: `${asset.sourceName ?? asset.legacy?.sourceName ?? ''}${pageSuffix}`,
      category,
      kind,
      mimeType: source.mimeType,
      url: source.url,
      origin: 'projectAsset',
      sourceKind,
      visibleToViewers: sourceKind === 'floorPlan' && placedImportKeys.has(floorPlanImportKey(asset)),
      includeInExport: false,
      links: [],
      addedAt,
    }
    const metadata = derivedMetadataBySourceId.get(asset.id)
    // The name of a derived document follows its source file.
    documents.push(applyDocumentMetadata(document, metadata && { ...metadata, name: undefined }))
  }

  for (const asset of floorPlanByImport.values()) pushAssetDocument(asset, 'sourcePlan', 'floorPlan')
  for (const asset of assets) {
    if (asset.kind === 'import-source') pushAssetDocument(asset, 'schematic', 'importSource')
  }
  return [...documents, ...userDocuments]
}

/** A persisted asset for an uploaded file. */
export function createProjectDocumentAsset(input: {
  id: string
  fileName: string
  mimeType: string
  dataUrl: string
  sizeBytes: number
  addedAt: string
  category?: ProjectDocumentCategory
  teamDocumentId?: string
}): AssetModelV2 {
  return {
    id: input.id,
    kind: PROJECT_DOCUMENT_ASSET_KIND,
    sourceName: input.fileName,
    mimeType: input.mimeType,
    dataUrl: input.dataUrl,
    sizeBytes: input.sizeBytes,
    document: {
      name: input.fileName,
      category: input.category ?? guessProjectDocumentCategory(input.fileName),
      links: [],
      addedAt: input.addedAt,
      ...(input.teamDocumentId ? { teamDocumentId: input.teamDocumentId } : {}),
    },
  }
}

/** A persisted asset for a new, empty external influences table. */
export function createExternalInfluencesDocumentAsset(input: {
  id: string
  name: string
  addedAt: string
}): AssetModelV2 {
  return {
    id: input.id,
    kind: PROJECT_DOCUMENT_ASSET_KIND,
    document: {
      name: input.name,
      category: 'inspection',
      links: [],
      addedAt: input.addedAt,
      externalInfluences: { rooms: [] },
    },
  }
}

/**
 * The asset to write for an edit: the upload itself, or the metadata entry that annotates a
 * derived document's source file. Null when the document no longer exists.
 */
export function getProjectDocumentPatchAsset(
  assets: readonly AssetModelV2[],
  documentId: string,
  patch: ProjectDocumentPatch
): AssetModelV2 | null {
  if (documentId === CABLE_SCHEDULE_DOCUMENT_ID) {
    if (patch.includeInExport === undefined) return null
    return {
      id: CABLE_SCHEDULE_SETTINGS_ASSET_ID,
      kind: PROJECT_DOCUMENT_ASSET_KIND,
      document: { builtIn: 'cableSchedule', includeInExport: patch.includeInExport },
    }
  }
  if (documentId === CONTROL_ADDRESSES_DOCUMENT_ID) {
    if (patch.includeInExport === undefined) return null
    return {
      id: CONTROL_ADDRESSES_SETTINGS_ASSET_ID,
      kind: PROJECT_DOCUMENT_ASSET_KIND,
      document: { builtIn: 'controlAddresses', includeInExport: patch.includeInExport },
    }
  }
  if (documentId.startsWith(DERIVED_DOCUMENT_ID_PREFIX)) {
    const sourceAssetId = documentId.slice(DERIVED_DOCUMENT_ID_PREFIX.length)
    if (!assets.some((asset) => asset.id === sourceAssetId)) return null
    const overlayId = `${DOCUMENT_OVERLAY_ASSET_ID_PREFIX}${sourceAssetId}`
    const current = assets.find((asset) => asset.id === overlayId)
    const { name: _name, ...editable } = patch
    return {
      id: overlayId,
      kind: PROJECT_DOCUMENT_ASSET_KIND,
      document: { ...current?.document, ...editable, sourceAssetId },
    }
  }
  const upload = assets.find((asset) => asset.id === documentId && isProjectDocumentAsset(asset))
  if (!upload) return null
  return { ...upload, document: { ...upload.document, ...patch } }
}

/**
 * An uploaded document with a new file: same id, category, links, and export choice. A name the
 * user never changed follows the new file name. Null when the document is not an upload.
 */
export function getProjectDocumentReplacementAsset(
  assets: readonly AssetModelV2[],
  documentId: string,
  file: { fileName: string; mimeType: string; dataUrl: string; sizeBytes: number }
): AssetModelV2 | null {
  const upload = assets.find((asset) => asset.id === documentId && isProjectDocumentAsset(asset))
  if (!upload || upload.document?.sourceAssetId) return null
  const renamed = Boolean(upload.document?.name) && upload.document?.name !== upload.sourceName
  // A new file is no longer the team library's copy.
  const { teamDocumentId: _teamDocumentId, ...metadata } = upload.document ?? {}
  return {
    ...upload,
    sourceName: file.fileName,
    mimeType: file.mimeType,
    dataUrl: file.dataUrl,
    sizeBytes: file.sizeBytes,
    document: { ...metadata, name: renamed ? upload.document?.name : file.fileName },
  }
}

/** Current links of a document with `link` added, or removed when already present. */
export function toggleProjectDocumentLink(
  document: ProjectDocument,
  link: ProjectDocumentLink
): ProjectDocumentLink[] {
  return isProjectDocumentLinkedTo(document, link)
    ? document.links.filter((entry) => entry.type !== link.type || entry.id !== link.id)
    : [...document.links, link]
}

/** Current links of a document with every `links` entry added; ones already present stay as is. */
export function addProjectDocumentLinks(
  document: ProjectDocument,
  links: readonly ProjectDocumentLink[]
): ProjectDocumentLink[] {
  const next = [...document.links]
  for (const link of links) {
    if (!next.some((entry) => entry.type === link.type && entry.id === link.id)) next.push(link)
  }
  return next
}

/** Non-empty groups in display order. */
export function groupProjectDocuments(documents: readonly ProjectDocument[]): ProjectDocumentGroup[] {
  return PROJECT_DOCUMENT_CATEGORIES.map((category) => ({
    category,
    documents: documents.filter((document) => document.category === category),
  })).filter((group) => group.documents.length > 0)
}

export function isProjectDocumentLinkedTo(
  document: ProjectDocument,
  target: ProjectDocumentLink
): boolean {
  return document.links.some((link) => link.type === target.type && link.id === target.id)
}

export function getDocumentsLinkedTo(
  documents: readonly ProjectDocument[],
  target: ProjectDocumentLink
): ProjectDocument[] {
  return documents.filter((document) => isProjectDocumentLinkedTo(document, target))
}

/**
 * A floor plan is exported as the situation plan itself, so it never goes along as a document.
 * The built-in views with export pages are the cable schedule and the domotica address table.
 */
export function canExportProjectDocument(
  document: Pick<ProjectDocument, 'sourceKind'> &
    Partial<Pick<ProjectDocument, 'kind' | 'origin'>>
): boolean {
  if (document.origin === 'builtIn') {
    return document.kind === 'cableSchedule' || document.kind === 'controlAddresses'
  }
  return document.sourceKind !== 'floorPlan'
}

/**
 * Documents can move between categories, except a floor plan placed on the situation plan: it
 * stays with the source plans as long as the drawing uses it.
 */
export function canMoveProjectDocument(
  document: Pick<ProjectDocument, 'sourceKind' | 'visibleToViewers'> &
    Partial<Pick<ProjectDocument, 'origin'>>
): boolean {
  if (document.origin === 'builtIn') return false
  return !(document.sourceKind === 'floorPlan' && document.visibleToViewers)
}

/**
 * The category after a link change: an uncategorised document linked to its first device becomes
 * device documentation. Any category the user chose is kept.
 */
export function getCategoryAfterLinking(
  document: Pick<ProjectDocument, 'category' | 'links'>,
  nextLinks: readonly ProjectDocumentLink[]
): ProjectDocumentCategory {
  return document.category === 'other' && document.links.length === 0 && nextLinks.length > 0
    ? 'datasheet'
    : document.category
}

/** User documents can be removed; so can a floor plan, which also takes it off the situation plan. */
export function canRemoveProjectDocument(
  document: Pick<ProjectDocument, 'origin' | 'sourceKind'>
): boolean {
  return (
    document.origin === 'upload' ||
    document.origin === 'generated' ||
    document.sourceKind === 'floorPlan'
  )
}

/**
 * Assets that make up a floor-plan document (its source, processed and vector variants from the
 * same import) and the floors that show it. Null for any other document.
 */
export function getFloorPlanDocumentUsage(
  assets: readonly AssetModelV2[],
  floors: ReadonlyArray<{ id: string; name?: string; planAssetId?: string; processedPlanAssetId?: string }>,
  documentId: string
): { planAssetId: string; floors: Array<{ id: string; name?: string }> } | null {
  if (!documentId.startsWith(DERIVED_DOCUMENT_ID_PREFIX)) return null
  const planAssetId = documentId.slice(DERIVED_DOCUMENT_ID_PREFIX.length)
  const group = getFloorPlanImportAssetIds(assets, planAssetId)
  if (group.length === 0) return null
  return {
    planAssetId,
    floors: getFloorsShowingPlanAssets(floors, new Set(group)).map(({ id, name }) => ({ id, name })),
  }
}

/** External influences tables are a paid-project feature, in the editor and in exports. */
export function isPaidProjectDocument(document: Pick<ProjectDocument, 'kind'>): boolean {
  return document.kind === 'externalInfluences'
}

/** Documents marked for export in category order; unpaid exports leave paid-only tables out. */
export function getExportedProjectDocuments(
  documents: readonly ProjectDocument[],
  { includePaid = true }: { includePaid?: boolean } = {}
): ProjectDocument[] {
  return groupProjectDocuments(documents).flatMap((group) =>
    group.documents.filter(
      (document) =>
        document.includeInExport &&
        canExportProjectDocument(document) &&
        (includePaid || !isPaidProjectDocument(document))
    )
  )
}

/**
 * Symbols of devices a document can be attached to: equipment with a datasheet, manual, or
 * certificate worth keeping (appliances, EV chargers, HVAC, energy meters, domotics, inverters,
 * batteries, solar, and DC rails). Switches, lights, sockets, protections, and earthing do not.
 */
const DOCUMENT_LINKABLE_SYMBOLS = new Set<string>([
  'fixed_appliance_generic',
  'oven',
  'washer',
  'dryer',
  'dishwasher',
  'boiler',
  'freezer',
  'fridge',
  'microwave',
  'motor',
  'stove',
  'ev',
  'furnace',
  'heating',
  'ventilation',
  'domotica',
  'energy_meter',
  'transformer',
  'rectifier',
  'inverter',
  'dc_dc_converter',
  'solar_panel',
  'battery',
  'dc_bus',
])

/** Endpoint types that are linkable when an endpoint has no specific symbol. */
const DOCUMENT_LINKABLE_ENDPOINT_TYPES = new Set<string>(['fixed_appliance', 'domotica'])

export interface DocumentLinkLookup {
  getPlacement: (id: string) => { endpointId?: string; trunkDeviceId?: string } | undefined
  getEndpoint: (id: string) => { type: string; symbol?: string } | undefined
  getTrunkDevice: (id: string) => { symbol: string } | undefined
}

export function isDocumentLinkableDevice(device: { type?: string; symbol?: string }): boolean {
  if (device.symbol) return DOCUMENT_LINKABLE_SYMBOLS.has(device.symbol)
  return device.type !== undefined && DOCUMENT_LINKABLE_ENDPOINT_TYPES.has(device.type)
}

/**
 * The device a selection represents for document links, or null when documents do not apply.
 * Plan placements resolve to the endpoint or supply device they place, so a datasheet follows
 * the device across canvases.
 */
export function resolveDocumentLinkTarget(
  selectionType: string | null | undefined,
  id: string,
  lookup: DocumentLinkLookup
): Pick<ProjectDocumentLink, 'type' | 'id'> | null {
  let target: Pick<ProjectDocumentLink, 'type' | 'id'> | null = null
  if (selectionType === 'placement') {
    const placement = lookup.getPlacement(id)
    if (placement?.endpointId) target = { type: 'endpoint', id: placement.endpointId }
    else if (placement?.trunkDeviceId) target = { type: 'trunkDevice', id: placement.trunkDeviceId }
  } else if (selectionType === 'endpoint' || selectionType === 'trunkDevice') {
    target = { type: selectionType, id }
  }
  if (!target) return null
  const device =
    target.type === 'endpoint' ? lookup.getEndpoint(target.id) : lookup.getTrunkDevice(target.id)
  return device && isDocumentLinkableDevice(device) ? target : null
}
