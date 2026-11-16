import type { AssetModelV2, AssetKindV2, ProjectV2 } from '@/types/projectV2'
import { isProjectDocumentAsset } from '@/lib/projectV2/documentAssets'

export const PROJECT_ASSET_REF_PREFIX = 'asset://'
export const LOCAL_PROJECT_ASSET_REF_PREFIX = `${PROJECT_ASSET_REF_PREFIX}local/`

export type ProjectAssetBlobKind =
  | 'floorplan_source'
  | 'floorplan_processed'
  | 'floorplan_vector_svg'
  | 'installer_logo'
  | 'installer_signature'
  | 'import_source_trik'
  | 'import_source_schematicals'
  | 'project_document'
  /** A document not linked to any device; stored where only project editors can read it. */
  | 'project_document_private'

export interface ProjectAssetBlob {
  id: string
  projectId: string
  kind: ProjectAssetBlobKind
  mimeType: string
  byteSize: number
  sha256: string
  bytes: Uint8Array
  createdAt: string
  updatedAt: string
}

type PendingAssetBlob = Omit<ProjectAssetBlob, 'createdAt' | 'updatedAt'>

export type ProjectAssetRefScope = 'local' | 'supabase'

export type ProjectAssetBlobJson = Omit<ProjectAssetBlob, 'bytes'> & {
  bytesBase64: string
}

type DecodedPayload = {
  mimeType: string
  bytes: Uint8Array
}

type AssetImportSource = {
  dataUrl: string
}

type AssetManagedProject = {
  building?: ProjectV2['building']
  assets?: AssetModelV2[]
  project: {
    id: string
    installerOverride?: {
      logoDataUrl: string | null
      signatureDataUrl: string | null
    }
    importSources?: {
      trik?: AssetImportSource
      schematicals?: AssetImportSource
    }
  }
}

export type ExternalizedProjectAssets<T extends AssetManagedProject = AssetManagedProject> = {
  project: T
  assets: PendingAssetBlob[]
  assetIds: Set<string>
}

export interface ProjectAssetBlobReader {
  get(assetId: string): Promise<ProjectAssetBlob | undefined>
}

function isProjectAssetRef(value: string | undefined | null): value is string {
  return typeof value === 'string' && value.startsWith(PROJECT_ASSET_REF_PREFIX)
}

function assetIdFromRef(value: string): string {
  const slashIndex = value.indexOf('/', PROJECT_ASSET_REF_PREFIX.length)
  return slashIndex === -1
    ? value.slice(PROJECT_ASSET_REF_PREFIX.length)
    : value.slice(slashIndex + 1)
}

function projectAssetRef(scope: ProjectAssetRefScope, assetId: string): string {
  return `${PROJECT_ASSET_REF_PREFIX}${scope}/${assetId}`
}

function decodeDataUrl(dataUrl: string): DecodedPayload | null {
  if (!dataUrl.startsWith('data:')) return null
  const match = dataUrl.match(/^data:([^;,]+)(;base64)?,(.*)$/s)
  if (!match) return null

  const mimeType = match[1] ?? 'application/octet-stream'
  const isBase64 = !!match[2]
  const payload = match[3] ?? ''

  try {
    if (isBase64) {
      const binary = atob(payload)
      const bytes = new Uint8Array(binary.length)
      for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i)
      }
      return { mimeType, bytes }
    }

    return {
      mimeType,
      bytes: new TextEncoder().encode(decodeURIComponent(payload)),
    }
  } catch {
    return null
  }
}

function bytesToDataUrl(mimeType: string, bytes: Uint8Array): string {
  return `data:${mimeType};base64,${bytesToBase64(bytes)}`
}

export function bytesToBase64(bytes: Uint8Array): string {
  let binaryString = ''
  const chunkSize = 0x8000
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize)
    binaryString += String.fromCharCode(...chunk)
  }
  return btoa(binaryString)
}

export function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i)
  }
  return bytes
}

export function projectAssetBlobToJson(asset: ProjectAssetBlob): ProjectAssetBlobJson {
  const { bytes, ...rest } = asset
  return {
    ...rest,
    bytesBase64: bytesToBase64(bytes),
  }
}

export function projectAssetBlobFromJson(asset: ProjectAssetBlobJson): ProjectAssetBlob {
  const { bytesBase64, ...rest } = asset
  return {
    ...rest,
    bytes: base64ToBytes(bytesBase64),
  }
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

async function sha256(bytes: Uint8Array): Promise<string> {
  const data = new Uint8Array(bytes).buffer as ArrayBuffer
  const digest = await crypto.subtle.digest('SHA-256', data)
  return bytesToHex(new Uint8Array(digest))
}

async function createAssetBlob(
  projectId: string,
  kind: ProjectAssetBlobKind,
  payload: DecodedPayload
): Promise<PendingAssetBlob> {
  const hash = await sha256(payload.bytes)
  return {
    id: `${kind}-${hash}`,
    projectId,
    kind,
    mimeType: payload.mimeType,
    byteSize: payload.bytes.byteLength,
    sha256: hash,
    bytes: payload.bytes,
  }
}

async function externalizeDataUrlField(
  projectId: string,
  kind: ProjectAssetBlobKind,
  value: string | undefined | null,
  setValue: (value: string) => void,
  assetsById: Map<string, PendingAssetBlob>,
  assetIds: Set<string>,
  refScope: ProjectAssetRefScope
): Promise<void> {
  if (!value) return
  if (isProjectAssetRef(value)) {
    assetIds.add(assetIdFromRef(value))
    return
  }

  const payload = decodeDataUrl(value)
  if (!payload) return

  const asset = await createAssetBlob(projectId, kind, payload)
  assetsById.set(asset.id, asset)
  assetIds.add(asset.id)
  setValue(projectAssetRef(refScope, asset.id))
}

async function externalizeTextField(
  projectId: string,
  kind: ProjectAssetBlobKind,
  value: string | undefined | null,
  setValue: (value: string) => void,
  assetsById: Map<string, PendingAssetBlob>,
  assetIds: Set<string>,
  refScope: ProjectAssetRefScope
): Promise<void> {
  if (!value) return
  if (isProjectAssetRef(value)) {
    assetIds.add(assetIdFromRef(value))
    return
  }

  const asset = await createAssetBlob(projectId, kind, {
    mimeType: 'image/svg+xml',
    bytes: new TextEncoder().encode(value),
  })
  assetsById.set(asset.id, asset)
  assetIds.add(asset.id)
  setValue(projectAssetRef(refScope, asset.id))
}

function isNativeFloorPlanAssetKind(kind: AssetKindV2): boolean {
  return (
    kind === 'floorplan-source' || kind === 'floorplan-processed' || kind === 'floorplan-vector'
  )
}

function assetBlobKindForNativeFloorPlanAsset(asset: AssetModelV2): ProjectAssetBlobKind {
  if (asset.kind === 'floorplan-processed') return 'floorplan_processed'
  if (asset.kind === 'floorplan-vector') return 'floorplan_vector_svg'
  return 'floorplan_source'
}

function shouldOmitNativeFloorPlanSource(
  project: AssetManagedProject,
  asset: AssetModelV2,
  omitRedundantFloorPlanSources: boolean
): boolean {
  if (!omitRedundantFloorPlanSources || asset.kind !== 'floorplan-source') return false
  return Boolean(
    project.building?.floors?.some(
      (floor) => floor.planAssetId === asset.id && Boolean(floor.processedPlanAssetId)
    )
  )
}

export async function externalizeProjectAssetBlobs<T extends AssetManagedProject>(
  project: T,
  options?: { refScope?: ProjectAssetRefScope; omitRedundantFloorPlanSources?: boolean }
): Promise<ExternalizedProjectAssets<T>> {
  const nextProject = JSON.parse(JSON.stringify(project)) as T
  const projectId = nextProject.project.id
  const refScope = options?.refScope ?? 'local'
  const omitRedundantFloorPlanSources = options?.omitRedundantFloorPlanSources === true
  const assetsById = new Map<string, PendingAssetBlob>()
  const assetIds = new Set<string>()

  // Preserve the caller's legacy boundary shape while canonical assets are
  // externalized; editor hydration removes the field after normalization.

  for (const asset of nextProject.assets ?? []) {
    if (!isNativeFloorPlanAssetKind(asset.kind)) continue
    if (omitRedundantFloorPlanSources && asset.kind === 'floorplan-vector' && asset.svgContent) {
      asset.dataUrl = undefined
      if (asset.legacy) {
        asset.legacy.dataUrl = undefined
      }
    }
    const shouldOmitRasterSource = shouldOmitNativeFloorPlanSource(
      nextProject,
      asset,
      omitRedundantFloorPlanSources
    )

    if (shouldOmitRasterSource) {
      asset.dataUrl = undefined
      if (asset.legacy) {
        asset.legacy.dataUrl = undefined
      }
      continue
    }

    if (asset.dataUrl) {
      await externalizeDataUrlField(
        projectId,
        assetBlobKindForNativeFloorPlanAsset(asset),
        asset.dataUrl,
        (value) => {
          asset.dataUrl = value
          if (asset.legacy) {
            if (asset.kind === 'floorplan-processed') {
              asset.legacy.processedDataUrl = value
            } else {
              asset.legacy.dataUrl = value
            }
          }
        },
        assetsById,
        assetIds,
        refScope
      )
    }

    if (asset.svgContent) {
      await externalizeTextField(
        projectId,
        'floorplan_vector_svg',
        asset.svgContent,
        (value) => {
          asset.svgContent = value
          if (asset.legacy) asset.legacy.svgContent = value
        },
        assetsById,
        assetIds,
        refScope
      )
    }
  }

  for (const asset of nextProject.assets ?? []) {
    if (!isProjectDocumentAsset(asset) || !asset.dataUrl) continue
    // Linking or unlinking a device changes the id, so the next save moves the file.
    const linkedToDevice = (asset.document?.links?.length ?? 0) > 0
    await externalizeDataUrlField(
      projectId,
      linkedToDevice ? 'project_document' : 'project_document_private',
      asset.dataUrl,
      (value) => {
        asset.dataUrl = value
      },
      assetsById,
      assetIds,
      refScope
    )
  }

  const installerOverride = nextProject.project.installerOverride
  if (installerOverride?.logoDataUrl) {
    await externalizeDataUrlField(
      projectId,
      'installer_logo',
      installerOverride.logoDataUrl,
      (value) => {
        installerOverride.logoDataUrl = value
      },
      assetsById,
      assetIds,
      refScope
    )
  }
  if (installerOverride?.signatureDataUrl) {
    await externalizeDataUrlField(
      projectId,
      'installer_signature',
      installerOverride.signatureDataUrl,
      (value) => {
        installerOverride.signatureDataUrl = value
      },
      assetsById,
      assetIds,
      refScope
    )
  }

  const trik = nextProject.project.importSources?.trik
  if (trik?.dataUrl) {
    await externalizeDataUrlField(
      projectId,
      'import_source_trik',
      trik.dataUrl,
      (value) => {
        trik.dataUrl = value
      },
      assetsById,
      assetIds,
      refScope
    )
  }

  const schematicals = nextProject.project.importSources?.schematicals
  if (schematicals?.dataUrl) {
    await externalizeDataUrlField(
      projectId,
      'import_source_schematicals',
      schematicals.dataUrl,
      (value) => {
        schematicals.dataUrl = value
      },
      assetsById,
      assetIds,
      refScope
    )
  }

  return {
    project: nextProject,
    assets: Array.from(assetsById.values()),
    assetIds,
  }
}

/** Looks up an already available asset blob; undefined leaves the ref in place. */
export type ProjectAssetBlobLookup = (assetId: string) => ProjectAssetBlob | undefined

function refAssetId(value: string | undefined | null): string | null {
  return isProjectAssetRef(value) ? assetIdFromRef(value) : null
}

function resolveDataUrl(
  value: string | undefined | null,
  lookup: ProjectAssetBlobLookup
): string | undefined {
  const assetId = refAssetId(value)
  const asset = assetId ? lookup(assetId) : undefined
  return asset ? bytesToDataUrl(asset.mimeType, asset.bytes) : undefined
}

function resolveText(
  value: string | undefined | null,
  lookup: ProjectAssetBlobLookup
): string | undefined {
  const assetId = refAssetId(value)
  const asset = assetId ? lookup(assetId) : undefined
  return asset ? new TextDecoder().decode(asset.bytes) : undefined
}

/**
 * Every stored-asset ref the editor replaces with content, in load order: plan images and SVGs,
 * documents, installer logo and signature, import sources. Duplicates are listed once.
 */
export function listHydratableProjectAssetIds(project: AssetManagedProject): string[] {
  const ids = new Set<string>()
  const add = (value: string | undefined | null) => {
    const assetId = refAssetId(value)
    if (assetId) ids.add(assetId)
  }
  for (const asset of project.assets ?? []) {
    if (isProjectDocumentAsset(asset)) {
      add(asset.dataUrl)
      continue
    }
    if (!isNativeFloorPlanAssetKind(asset.kind)) continue
    add(asset.dataUrl)
    add(asset.svgContent)
  }
  add(project.project.installerOverride?.logoDataUrl)
  add(project.project.installerOverride?.signatureDataUrl)
  add(project.project.importSources?.trik?.dataUrl)
  add(project.project.importSources?.schematicals?.dataUrl)
  return [...ids]
}

function hydrateAsset(asset: AssetModelV2, lookup: ProjectAssetBlobLookup): AssetModelV2 {
  if (isProjectDocumentAsset(asset)) {
    const dataUrl = resolveDataUrl(asset.dataUrl, lookup)
    return dataUrl === undefined ? asset : { ...asset, dataUrl }
  }
  if (!isNativeFloorPlanAssetKind(asset.kind)) return asset

  const dataUrl = resolveDataUrl(asset.dataUrl, lookup)
  const svgContent = resolveText(asset.svgContent, lookup)
  if (dataUrl === undefined && svgContent === undefined) return asset

  const next: AssetModelV2 = { ...asset }
  const legacy = asset.legacy ? { ...asset.legacy } : undefined
  if (dataUrl !== undefined) {
    next.dataUrl = dataUrl
    if (legacy) {
      if (asset.kind === 'floorplan-processed') legacy.processedDataUrl = dataUrl
      else legacy.dataUrl = dataUrl
    }
  }
  if (svgContent !== undefined) {
    next.svgContent = svgContent
    if (legacy) legacy.svgContent = svgContent
  }
  if (legacy) next.legacy = legacy
  return next
}

/**
 * Replaces the stored-asset refs whose blob `lookup` already has with their content, without
 * waiting on any download. Untouched parts keep their identity, so a frozen project stays shared
 * where nothing changed; refs without a blob stay as they are. Returns `project` itself when
 * nothing was replaced.
 */
export function hydrateProjectAssetBlobsFrom<T extends AssetManagedProject>(
  project: T,
  lookup: ProjectAssetBlobLookup
): T {
  let assetsChanged = false
  const assets = project.assets?.map((asset) => {
    const next = hydrateAsset(asset, lookup)
    if (next !== asset) assetsChanged = true
    return next
  })

  const meta = project.project
  const override = meta.installerOverride
  const logoDataUrl = resolveDataUrl(override?.logoDataUrl, lookup)
  const signatureDataUrl = resolveDataUrl(override?.signatureDataUrl, lookup)
  const trikDataUrl = resolveDataUrl(meta.importSources?.trik?.dataUrl, lookup)
  const schematicalsDataUrl = resolveDataUrl(meta.importSources?.schematicals?.dataUrl, lookup)
  const overrideChanged = logoDataUrl !== undefined || signatureDataUrl !== undefined
  const sourcesChanged = trikDataUrl !== undefined || schematicalsDataUrl !== undefined
  if (!assetsChanged && !overrideChanged && !sourcesChanged) return project

  let nextMeta = meta
  if (overrideChanged && override) {
    nextMeta = {
      ...nextMeta,
      installerOverride: {
        ...override,
        ...(logoDataUrl !== undefined ? { logoDataUrl } : {}),
        ...(signatureDataUrl !== undefined ? { signatureDataUrl } : {}),
      },
    }
  }
  const sources = meta.importSources
  if (sourcesChanged && sources) {
    nextMeta = {
      ...nextMeta,
      importSources: {
        ...sources,
        ...(trikDataUrl !== undefined && sources.trik
          ? { trik: { ...sources.trik, dataUrl: trikDataUrl } }
          : {}),
        ...(schematicalsDataUrl !== undefined && sources.schematicals
          ? { schematicals: { ...sources.schematicals, dataUrl: schematicalsDataUrl } }
          : {}),
      },
    }
  }

  return {
    ...project,
    ...(assetsChanged ? { assets } : {}),
    ...(nextMeta !== meta ? { project: nextMeta } : {}),
  }
}

/** Returns a copy of `project` with every stored-asset ref `reader` can supply replaced by its content. */
export async function hydrateProjectAssetBlobs<T extends AssetManagedProject>(
  project: T,
  reader: ProjectAssetBlobReader
): Promise<T> {
  const nextProject = JSON.parse(JSON.stringify(project)) as T
  const blobs = new Map<string, ProjectAssetBlob>()
  for (const assetId of listHydratableProjectAssetIds(nextProject)) {
    const asset = await reader.get(assetId)
    if (asset) blobs.set(assetId, asset)
  }
  return hydrateProjectAssetBlobsFrom(nextProject, (assetId) => blobs.get(assetId))
}
