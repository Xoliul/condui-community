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

async function hydrateDataUrlField(
  value: string | undefined | null,
  setValue: (value: string) => void,
  reader: ProjectAssetBlobReader
): Promise<void> {
  if (!isProjectAssetRef(value)) return
  const asset = await reader.get(assetIdFromRef(value))
  if (!asset) return
  setValue(bytesToDataUrl(asset.mimeType, asset.bytes))
}

async function hydrateTextField(
  value: string | undefined | null,
  setValue: (value: string) => void,
  reader: ProjectAssetBlobReader
): Promise<void> {
  if (!isProjectAssetRef(value)) return
  const asset = await reader.get(assetIdFromRef(value))
  if (!asset) return
  setValue(new TextDecoder().decode(asset.bytes))
}

export async function hydrateProjectAssetBlobs<T extends AssetManagedProject>(
  project: T,
  reader: ProjectAssetBlobReader
): Promise<T> {
  const nextProject = JSON.parse(JSON.stringify(project)) as T

  for (const asset of nextProject.assets ?? []) {
    if (isProjectDocumentAsset(asset)) {
      await hydrateDataUrlField(
        asset.dataUrl,
        (value) => {
          asset.dataUrl = value
        },
        reader
      )
      continue
    }
    if (!isNativeFloorPlanAssetKind(asset.kind)) continue

    await hydrateDataUrlField(
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
      reader
    )
    await hydrateTextField(
      asset.svgContent,
      (value) => {
        asset.svgContent = value
        if (asset.legacy) asset.legacy.svgContent = value
      },
      reader
    )
  }

  const installerOverride = nextProject.project.installerOverride
  if (installerOverride) {
    await hydrateDataUrlField(
      installerOverride.logoDataUrl,
      (value) => {
        installerOverride.logoDataUrl = value
      },
      reader
    )
    await hydrateDataUrlField(
      installerOverride.signatureDataUrl,
      (value) => {
        installerOverride.signatureDataUrl = value
      },
      reader
    )
  }

  const trik = nextProject.project.importSources?.trik
  if (trik) {
    await hydrateDataUrlField(
      trik.dataUrl,
      (value) => {
        trik.dataUrl = value
      },
      reader
    )
  }

  const schematicals = nextProject.project.importSources?.schematicals
  if (schematicals) {
    await hydrateDataUrlField(
      schematicals.dataUrl,
      (value) => {
        schematicals.dataUrl = value
      },
      reader
    )
  }

  return nextProject
}
