import JSZip from 'jszip'
import type { ProjectV2 } from '@/types/projectV2'
import i18n from '@/i18n'
import { shortProjectIdLabel } from '@/utils/project'
import { selectProjectBuildingFloors } from '@/lib/projectV2/buildingFloors'
import { selectProjectElectricalPanels } from '@/lib/projectV2/electrical'
import {
  normalizeStoredProjectToV2,
  projectToStoredProjectV2,
  type LegacyProjectDocument,
} from '@/lib/projectV2/migration'
import { sanitizeLegacyV2Project } from '@/lib/projectV2/sanitizeLegacyV2Project'
import {
  isProjectDocumentAsset,
  withoutProjectDocumentAssets,
} from '@/lib/projectV2/documentAssets'
import { repairDanglingSupplyAssemblyReferences } from '@/lib/supplyAssembly/repairDanglingReferences'
import { validateProjectStructure } from '@/utils/project'
/* @project-documents-strip-start */

/* @project-documents-strip-end */

export const PROJECT_JSON_FILENAME = 'project.json'
export const EXPORT_VERSION = '1'
export const ASSETS_FOLDER = 'assets'
export const VERSION_HISTORY_JSON_FILENAME =
  ['version', 'history'].join(String.fromCharCode(45)) + String.fromCharCode(46) + 'json'

const IMPORT_SOURCES_SUBFOLDER = 'sources'
const INSTALLER_SUBFOLDER = 'installer'
const DOCUMENTS_SUBFOLDER = 'documents'
const MAX_PROJECT_JSON_BYTES = 20 * 1024 * 1024
const MAX_LEGACY_BLOATED_PROJECT_JSON_BYTES = 160 * 1024 * 1024
const MAX_ZIP_ENTRIES = 5000
const MAX_SINGLE_ASSET_BYTES = 100 * 1024 * 1024
const MAX_TOTAL_ASSET_BYTES = 300 * 1024 * 1024

type AssetFileRef = {
  path: string
  bytes: Uint8Array
}

export type PortableVersionHistory = {
  mode: string
  versions: unknown[]
  [key: string]: unknown
}

export type PortableProjectExportOptions = {
  cachedPdf?: {
    blob: Blob
    filename?: string
    cachedAt?: string
    signature?: string
  }
  versionHistory?: PortableVersionHistory | null
  format?: string
  allowInvalidForDiagnostics?: boolean
  /** Leave attached documents out, keeping only what the drawings need. */
  excludeProjectDocuments?: boolean
}

export class ProjectExportValidationError extends Error {
  readonly code = 'PROJECT_EXPORT_VALIDATION'

  constructor(message: string) {
    super(message)
    this.name = 'ProjectExportValidationError'
  }
}

function sanitizePathSegment(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]/g, '_')
}

function mimeToExtension(mimeType: string): string {
  const normalized = mimeType.toLowerCase()
  if (normalized === 'image/jpeg') return 'jpg'
  if (normalized === 'image/png') return 'png'
  if (normalized === 'image/webp') return 'webp'
  if (normalized === 'image/gif') return 'gif'
  if (normalized === 'image/svg+xml') return 'svg'
  if (normalized === 'application/pdf') return 'pdf'
  if (normalized === 'application/xml' || normalized === 'text/xml') {
    return String.fromCharCode(116, 114, 105, 107)
  }
  if (normalized === 'application/json') return 'json'
  return 'bin'
}

function decodeDataUrl(dataUrl: string): Uint8Array | null {
  if (!dataUrl.startsWith('data:')) return null
  const match = dataUrl.match(/^data:([^;,]+)(;base64)?,(.*)$/s)
  if (!match) return null
  const payload = match[3] ?? ''

  try {
    if (match[2]) {
      const binary = atob(payload)
      const bytes = new Uint8Array(binary.length)
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
      return bytes
    }
    return new TextEncoder().encode(decodeURIComponent(payload))
  } catch {
    return null
  }
}

function createAssetPath(
  projectId: string,
  floorId: string,
  assetId: string,
  variant: string,
  mimeType: string,
): string {
  return `${ASSETS_FOLDER}/project-${sanitizePathSegment(projectId)}/floor-${sanitizePathSegment(floorId)}/${sanitizePathSegment(assetId)}-${variant}.${mimeToExtension(mimeType)}`
}

function createFloorAssetPath(
  projectId: string,
  floorId: string,
  assetId: string,
  variant: string,
  dataUrl: string,
): AssetFileRef | null {
  const bytes = decodeDataUrl(dataUrl)
  if (!bytes) return null
  const mimeType = dataUrl.slice(5, dataUrl.search(/[;,]/)).toLowerCase() || 'application/octet-stream'
  return {
    path: createAssetPath(projectId, floorId, assetId, variant, mimeType),
    bytes,
  }
}

function createTextAssetPath(
  projectId: string,
  floorId: string,
  assetId: string,
  svgContent: string,
): AssetFileRef {
  return {
    path: `${ASSETS_FOLDER}/project-${sanitizePathSegment(projectId)}/floor-${sanitizePathSegment(floorId)}/${sanitizePathSegment(assetId)}-vector.svg`,
    bytes: new TextEncoder().encode(svgContent),
  }
}

function findFloorIdForAsset(project: ProjectV2, assetId: string): string {
  const floor = selectProjectBuildingFloors(project).find((candidate) => {
    if ('planAssetId' in candidate || 'processedPlanAssetId' in candidate) {
      return candidate.planAssetId === assetId || candidate.processedPlanAssetId === assetId
    }
    if (!('layers' in candidate || 'floorPlan' in candidate)) return false
    return (
      candidate.planAsset === assetId ||
      candidate.planAssetProcessed === assetId ||
      candidate.planImportAsset?.id === assetId
    )
  })
  return floor?.id || 'floor'
}

function externalizeAssets(project: ProjectV2): { project: ProjectV2; files: AssetFileRef[] } {
  const nextProject = JSON.parse(JSON.stringify(project)) as ProjectV2
  const files: AssetFileRef[] = []
  const projectId = nextProject.project.id || 'project'

  for (const asset of nextProject.assets) {
    if (
      asset.kind !== 'floorplan-source' &&
      asset.kind !== 'floorplan-processed' &&
      asset.kind !== 'floorplan-vector'
    ) continue
    const floorId = findFloorIdForAsset(nextProject, asset.id)

    if (asset.dataUrl?.startsWith('data:')) {
      const ref = createFloorAssetPath(
        projectId,
        floorId,
        asset.id,
        asset.kind === 'floorplan-processed' ? 'processed' : 'source',
        asset.dataUrl,
      )
      if (ref) {
        files.push(ref)
        asset.dataUrl = ref.path
      }
    }
    if (asset.svgContent) {
      const ref = createTextAssetPath(projectId, floorId, asset.id, asset.svgContent)
      files.push(ref)
      asset.svgContent = ref.path
    }
    if (asset.legacy?.dataUrl) asset.legacy.dataUrl = asset.dataUrl
    if (asset.legacy?.processedDataUrl && asset.kind === 'floorplan-processed') {
      asset.legacy.processedDataUrl = asset.dataUrl
    }
    if (asset.legacy?.svgContent) asset.legacy.svgContent = asset.svgContent
  }

  for (const asset of nextProject.assets) {
    if (
      asset.kind !== 'floorplan-source' &&
      asset.kind !== 'floorplan-processed' &&
      asset.kind !== 'floorplan-vector'
    ) continue
    if (!asset.legacy) continue
    asset.legacy.dataUrl = undefined
    asset.legacy.processedDataUrl = undefined
    asset.legacy.svgContent = undefined
  }

  for (const asset of nextProject.assets) {
    if (!isProjectDocumentAsset(asset) || !asset.dataUrl?.startsWith('data:')) continue
    const bytes = decodeDataUrl(asset.dataUrl)
    if (!bytes) continue
    const mimeType = asset.dataUrl.slice(5, asset.dataUrl.search(/[;,]/)).toLowerCase() || 'application/octet-stream'
    const baseName = (asset.document?.name || asset.sourceName || '').replace(/\.[a-z0-9]+$/i, '')
    const fileStem = [sanitizePathSegment(asset.id), baseName && sanitizePathSegment(baseName)]
      .filter(Boolean)
      .join('-')
    const path = `${ASSETS_FOLDER}/project-${sanitizePathSegment(projectId)}/${DOCUMENTS_SUBFOLDER}/${fileStem}.${mimeToExtension(mimeType)}`
    files.push({ path, bytes })
    asset.dataUrl = path
  }

  const importSources = nextProject.project.importSources
  for (const kind of ['trik', 'schematicals'] as const) {
    const source = importSources?.[kind]
    if (!source?.dataUrl?.startsWith('data:')) continue
    const bytes = decodeDataUrl(source.dataUrl)
    if (!bytes) continue
    const assetId = source.sha256 || source.originalFilename || 'original'
    const mimeType = source.dataUrl.slice(5, source.dataUrl.search(/[;,]/)).toLowerCase() || 'application/octet-stream'
    const path = `${ASSETS_FOLDER}/project-${sanitizePathSegment(projectId)}/${IMPORT_SOURCES_SUBFOLDER}/${kind}-${sanitizePathSegment(assetId)}.${mimeToExtension(mimeType)}`
    files.push({ path, bytes })
    source.dataUrl = path
  }

  const installer = nextProject.project.installerOverride
  if (installer) {
    for (const kind of ['logo', 'signature'] as const) {
      const key = `${kind}DataUrl` as const
      const dataUrl = installer[key]
      if (!dataUrl?.startsWith('data:')) continue
      const bytes = decodeDataUrl(dataUrl)
      if (!bytes) continue
      const mimeType = dataUrl.slice(5, dataUrl.search(/[;,]/)).toLowerCase() || 'application/octet-stream'
      const path = `${ASSETS_FOLDER}/project-${sanitizePathSegment(projectId)}/${INSTALLER_SUBFOLDER}/${kind}.${mimeToExtension(mimeType)}`
      files.push({ path, bytes })
      installer[key] = path
    }
  }

  return { project: nextProject, files }
}

/* @project-documents-strip-start */

/* @project-documents-strip-end */

function stripImportedVersionHistory(project: ProjectV2): ProjectV2 {
  const next = JSON.parse(JSON.stringify(project)) as ProjectV2
  delete (next.project as unknown as Record<string, unknown>).importedVersionHistory
  return next
}

function isPortableVersionHistory(value: unknown): value is PortableVersionHistory {
  return !!value && typeof value === 'object' && Array.isArray((value as { versions?: unknown }).versions)
}

export async function exportPortableProjectToZip(
  project: ProjectV2,
  options: PortableProjectExportOptions = {},
): Promise<Blob> {
  const normalizedProject = projectToStoredProjectV2(project as unknown as LegacyProjectDocument)
  const validation = validateProjectStructure(structuredClone(normalizedProject))
  if (!validation.valid && options.allowInvalidForDiagnostics !== true) {
    throw new ProjectExportValidationError(
      `Cannot export invalid project: ${validation.errors.join('; ')}`,
    )
  }

  const exportProject = stripImportedVersionHistory(
    options.excludeProjectDocuments === true
      ? withoutProjectDocumentAssets(normalizedProject)
      : normalizedProject,
  )
  const { project: projectWithAssets, files } = externalizeAssets(exportProject)
  /* @project-documents-strip-start */
  
  /* @project-documents-strip-end */
  const zip = new JSZip()

  for (const file of files) {
    zip.file(file.path, file.bytes, {
      binary: true,
      compression: 'DEFLATE',
      compressionOptions: { level: 6 },
    })
  }

  if (options.cachedPdf?.blob) {
    zip.file(
      options.cachedPdf.filename || 'latest-export.pdf',
      await options.cachedPdf.blob.arrayBuffer(),
      { binary: true, compression: 'DEFLATE', compressionOptions: { level: 6 } },
    )
  }

  const versionHistory = isPortableVersionHistory(options.versionHistory)
    ? options.versionHistory
    : null
  if (versionHistory) {
    zip.file(VERSION_HISTORY_JSON_FILENAME, JSON.stringify(versionHistory, null, 2), {
      compression: 'DEFLATE',
      compressionOptions: { level: 6 },
    })
  }

  zip.file(PROJECT_JSON_FILENAME, JSON.stringify(projectWithAssets, null, 2), {
    compression: 'DEFLATE',
    compressionOptions: { level: 6 },
  })
  zip.file(
    'manifest.json',
    JSON.stringify(
      {
        version: EXPORT_VERSION,
        projectId: projectWithAssets.project.id,
        projectName: projectWithAssets.project.name,
        exportedAt: new Date().toISOString(),
        format: options.format || 'project-with-assets',
        assets: { count: files.length, folder: ASSETS_FOLDER },
        cachedPdf: options.cachedPdf
          ? {
              filename: options.cachedPdf.filename || 'latest-export.pdf',
              cachedAt: options.cachedPdf.cachedAt,
              signature: options.cachedPdf.signature,
            }
          : null,
        versionHistory: versionHistory
          ? {
              filename: VERSION_HISTORY_JSON_FILENAME,
              mode: versionHistory.mode,
              versionCount: versionHistory.versions.length,
              snapshotHistoryIncluded: false,
            }
          : null,
      },
      null,
      2,
    ),
    { compression: 'DEFLATE', compressionOptions: { level: 6 } },
  )

  return zip.generateAsync({ type: 'blob', compression: 'DEFLATE', compressionOptions: { level: 6 } })
}

type AssetReadBudget = { totalBytes: number }

function isRecoverableLegacyBloatedProjectJson(rawJson: string): boolean {
  return (
    rawJson.length <= MAX_LEGACY_BLOATED_PROJECT_JSON_BYTES &&
    rawJson.includes('"legacy"') &&
    rawJson.includes('data:image/')
  )
}

function extensionToMimeType(path: string): string {
  const normalized = path.toLowerCase()
  if (normalized.endsWith('.jpg') || normalized.endsWith('.jpeg')) return 'image/jpeg'
  if (normalized.endsWith('.png')) return 'image/png'
  if (normalized.endsWith('.webp')) return 'image/webp'
  if (normalized.endsWith('.gif')) return 'image/gif'
  if (normalized.endsWith('.svg')) return 'image/svg+xml'
  if (normalized.endsWith('.pdf')) return 'application/pdf'
  const extension = normalized.slice(normalized.lastIndexOf('.') + 1)
  if (extension === 'xml' || extension === 'trik') return 'application/xml'
  if (normalized.endsWith('.json')) return 'application/json'
  return 'application/octet-stream'
}

function zipBytesToDataUrl(filename: string, bytes: Uint8Array): string {
  if (bytes.byteLength > MAX_SINGLE_ASSET_BYTES) throw new Error(`Asset file is too large: ${filename}`)
  let binaryString = ''
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binaryString += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  }
  return `data:${extensionToMimeType(filename)};base64,${btoa(binaryString)}`
}

async function readAssetBytes(zip: JSZip, path: string, budget: AssetReadBudget): Promise<Uint8Array> {
  const file = zip.file(path)
  if (!file) throw new Error(`Missing asset file in ZIP: ${path}`)
  const bytes = await file.async('uint8array')
  if (bytes.byteLength > MAX_SINGLE_ASSET_BYTES) throw new Error(`Asset file is too large: ${path}`)
  budget.totalBytes += bytes.byteLength
  if (budget.totalBytes > MAX_TOTAL_ASSET_BYTES) throw new Error('Total imported assets exceed maximum allowed size')
  return bytes
}

async function resolveAssetPathToDataUrl(zip: JSZip, value: string | undefined, budget: AssetReadBudget): Promise<string | undefined> {
  if (!value || value.startsWith('data:') || !value.startsWith(`${ASSETS_FOLDER}/`)) return value
  return zipBytesToDataUrl(value, await readAssetBytes(zip, value, budget))
}

async function resolveAssetPathToText(zip: JSZip, value: string | undefined, budget: AssetReadBudget): Promise<string | undefined> {
  if (!value || value.startsWith('data:') || !value.startsWith(`${ASSETS_FOLDER}/`)) return value
  return new TextDecoder().decode(await readAssetBytes(zip, value, budget))
}

export type ImportedPortableProjectPackage = {
  project: ProjectV2
  repairedDanglingSupplyHandoffs: number
}

export async function importPortableProjectPackageFromZip(
  zipInput: Blob | ArrayBuffer | Uint8Array,
): Promise<ImportedPortableProjectPackage> {
  const zipData =
    typeof Blob !== 'undefined' && zipInput instanceof Blob
      ? await zipInput.arrayBuffer()
      : zipInput
  const zip = await JSZip.loadAsync(zipData)
  const zipEntries = Object.keys(zip.files).length
  if (zipEntries === 0) throw new Error('ZIP archive is empty')
  if (zipEntries > MAX_ZIP_ENTRIES) throw new Error(`ZIP archive has too many entries (${zipEntries})`)

  const projectFile = zip.file(PROJECT_JSON_FILENAME)
  if (!projectFile) throw new Error(`ZIP does not contain required ${PROJECT_JSON_FILENAME}`)
  if (projectFile.dir) throw new Error(`${PROJECT_JSON_FILENAME} is a directory, expected a file`)

  let project: ProjectV2
  let repairedDanglingSupplyHandoffs = 0
  try {
    const rawJson = await projectFile.async('text')
    if (rawJson.length > MAX_PROJECT_JSON_BYTES && !isRecoverableLegacyBloatedProjectJson(rawJson)) {
      throw new Error(`${PROJECT_JSON_FILENAME} is too large`)
    }
    project = sanitizeLegacyV2Project(
      normalizeStoredProjectToV2(JSON.parse(rawJson) as LegacyProjectDocument),
    ).project
    repairedDanglingSupplyHandoffs = repairDanglingSupplyAssemblyReferences(project).repairedHandoffCount
  } catch (error) {
    throw new Error(
      `Failed to parse ${PROJECT_JSON_FILENAME}: ${error instanceof Error ? error.message : String(error)}`,
    )
  }

  if (!Array.isArray(selectProjectBuildingFloors(project))) {
    throw new Error('Invalid project format: missing floors array')
  }
  if (!project.project || typeof project.project !== 'object') {
    throw new Error('Invalid project format: missing project object')
  }
  if (typeof project.project.id !== 'string' || project.project.id.trim() === '') {
    throw new Error('Invalid project format: missing project id')
  }
  if (typeof project.project.name !== 'string' || project.project.name.trim() === '') {
    const idShort = shortProjectIdLabel(project.project.id.trim())
    project.project.name = i18n.t('diagnostics.importFallbackProjectName', {
      defaultValue: 'Imported project ({{idShort}})',
      idShort,
    })
  }
  if (!Array.isArray(selectProjectElectricalPanels(project))) {
    throw new Error('Invalid project format: missing panels array')
  }

  const assetReadBudget: AssetReadBudget = { totalBytes: 0 }
  for (const floor of selectProjectBuildingFloors(project)) {
    if (!('planAsset' in floor)) continue
    floor.planAsset = await resolveAssetPathToDataUrl(zip, floor.planAsset, assetReadBudget)
    floor.planAssetProcessed = await resolveAssetPathToDataUrl(zip, floor.planAssetProcessed, assetReadBudget)
    if (floor.planImportAsset) {
      floor.planImportAsset.dataUrl = await resolveAssetPathToDataUrl(zip, floor.planImportAsset.dataUrl, assetReadBudget)
      floor.planImportAsset.processedDataUrl = await resolveAssetPathToDataUrl(zip, floor.planImportAsset.processedDataUrl, assetReadBudget)
      floor.planImportAsset.svgContent = await resolveAssetPathToText(zip, floor.planImportAsset.svgContent, assetReadBudget)
    }
  }
  for (const asset of project.assets) {
    asset.dataUrl = await resolveAssetPathToDataUrl(zip, asset.dataUrl, assetReadBudget)
    asset.svgContent = await resolveAssetPathToText(zip, asset.svgContent, assetReadBudget)
  }

  for (const kind of ['trik', 'schematicals'] as const) {
    const source = project.project.importSources?.[kind]
    if (source) source.dataUrl = (await resolveAssetPathToDataUrl(zip, source.dataUrl, assetReadBudget)) as string
  }
  if (project.project.installerOverride) {
    project.project.installerOverride.logoDataUrl = (await resolveAssetPathToDataUrl(
      zip,
      project.project.installerOverride.logoDataUrl ?? undefined,
      assetReadBudget,
    )) ?? null
    project.project.installerOverride.signatureDataUrl = (await resolveAssetPathToDataUrl(
      zip,
      project.project.installerOverride.signatureDataUrl ?? undefined,
      assetReadBudget,
    )) ?? null
  }

  const validation = validateProjectStructure(project)
  if (!validation.valid) throw new Error(`Imported project failed validation: ${validation.errors.join('; ')}`)
  return { project, repairedDanglingSupplyHandoffs }
}

export async function importPortableProjectFromZip(
  zipInput: Blob | ArrayBuffer | Uint8Array,
): Promise<ProjectV2> {
  return (await importPortableProjectPackageFromZip(zipInput)).project
}
