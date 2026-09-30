import { create } from 'zustand'
import { createUuid } from '@/lib/uuid'
import {
  createProjectDocumentAsset,
  getProjectDocumentKind,
  getProjectDocumentPatchAsset,
  exportPagesAfterPagesDeletion,
  getFloorPlanDocumentUsage,
  getProjectDocumentReplacementAsset,
  getProjectDocuments,
  getProjectDocumentSizeBytes,
  getProjectDocumentsStorageBytes,
  MAX_PROJECT_DOCUMENT_BYTES,
  PROJECT_DOCUMENTS_STORAGE_LIMIT_BYTES,
  type ProjectDocumentCategory,
  type ProjectDocumentKind,
  type ProjectDocumentPatch,
} from '@/lib/documents/projectDocuments'
import {
  compressImage,
  compressPdf,
  isCompressibleImageType,
  readImageSize,
  shouldAutoOptimizeImage,
  type DocumentCompressionLevel,
} from '@/lib/documents/documentCompression'
import { logger } from '@/lib/logger'
import {
  getFloorPlanDocumentDisplayAssets,
  type FloorPlanDocumentDisplayPatch,
} from '@/lib/documents/floorPlanDocumentDisplay'
import { deletePdfPages } from '@/lib/documents/pdfPageEditing'
import { bytesToBase64 } from '@/lib/projectStorage/projectAssetBlobs'
import { isProjectDocumentAsset } from '@/lib/projectV2/documentAssets'
import { useProjectStore } from '@/stores/projectStore'

export type { ProjectDocumentPatch } from '@/lib/documents/projectDocuments'

export interface RejectedProjectDocumentFiles {
  unsupported: File[]
  tooLarge: File[]
  /** Accepted type and size, but the project's document storage is full. */
  overBudget: File[]
}

function currentDocumentsStorageBytes(): number {
  return getProjectDocumentsStorageBytes(
    getProjectDocuments(useProjectStore.getState().currentProject?.assets)
  )
}

interface ProjectDocumentsState {
  /** The open document belongs to one project; switching projects closes it. */
  projectId: string | null
  openDocumentId: string | null
  bindProject: (projectId: string | null) => void
  openDocument: (id: string | null) => void
}

/**
 * Session view state of the Documents canvas. The documents themselves, generated tables
 * included, are project assets and are saved, synced, and exported with the project.
 */
export const useProjectDocumentsStore = create<ProjectDocumentsState>((set, get) => ({
  projectId: null,
  openDocumentId: null,

  bindProject: (projectId) => {
    if (get().projectId === projectId) return
    set({ projectId, openDocumentId: projectId ? readSessionOpenDocument(projectId) : null })
  },

  openDocument: (id) => {
    set({ openDocumentId: id })
    const { projectId } = get()
    if (projectId) writeSessionOpenDocument(projectId, id)
  },
}))

/**
 * The open document is remembered per project for the browser session, so a reload or reopening
 * the project returns to it (a stale id simply shows the overview).
 */
const SESSION_OPEN_DOCUMENT_KEY = 'condui.documents.open.'

function readSessionOpenDocument(projectId: string): string | null {
  try {
    return window.sessionStorage.getItem(SESSION_OPEN_DOCUMENT_KEY + projectId)
  } catch {
    return null
  }
}

function writeSessionOpenDocument(projectId: string, documentId: string | null): void {
  try {
    if (documentId) window.sessionStorage.setItem(SESSION_OPEN_DOCUMENT_KEY + projectId, documentId)
    else window.sessionStorage.removeItem(SESSION_OPEN_DOCUMENT_KEY + projectId)
  } catch {
    // Storage unavailable (private mode, blocked site data): remember for this page only.
  }
}

function readFileAsDataUrl(file: Blob, mimeType: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const result = String(reader.result ?? '')
      // Browsers label unknown types `application/octet-stream`; keep the accepted type instead.
      resolve(result.replace(/^data:[^;,]*/, `data:${mimeType}`))
    }
    reader.onerror = () => reject(reader.error ?? new Error('Could not read the file'))
    reader.readAsDataURL(file)
  })
}

type DocumentFileCheck =
  | { ok: true; mimeType: string; kind: ProjectDocumentKind }
  | { ok: false; reason: keyof RejectedProjectDocumentFiles }

function checkDocumentFile(file: File): DocumentFileCheck {
  const kind = getProjectDocumentKind(file.type, file.name)
  if (!kind) return { ok: false, reason: 'unsupported' }
  if (file.size > MAX_PROJECT_DOCUMENT_BYTES) return { ok: false, reason: 'tooLarge' }
  return {
    ok: true,
    kind,
    mimeType: file.type || (kind === 'pdf' ? 'application/pdf' : 'image/png'),
  }
}

type PreparedFile = { blob: Blob; mimeType: string }

/**
 * The bytes to store for a file: large photos are optimized automatically, and `level` applies
 * stronger reduction (PDF pages re-rendered as images). The original is kept whenever the result
 * is not smaller, or when the browser cannot process the file.
 */
async function prepareDocumentFile(
  file: Blob,
  mimeType: string,
  kind: ProjectDocumentKind,
  level?: Exclude<DocumentCompressionLevel, 'auto'>
): Promise<PreparedFile> {
  const original = { blob: file, mimeType }
  try {
    if (kind === 'image' && isCompressibleImageType(mimeType)) {
      const autoLevel =
        level ??
        (shouldAutoOptimizeImage({ mimeType, sizeBytes: file.size, ...(await readImageSize(file)) })
          ? 'auto'
          : null)
      if (!autoLevel) return original
      const compressed = await compressImage(file, autoLevel)
      return compressed.blob.size < file.size ? compressed : original
    }
    if (kind === 'pdf' && level) {
      const bytes = await compressPdf(new Uint8Array(await file.arrayBuffer()), level)
      return bytes.byteLength < file.size
        ? { blob: new Blob([new Uint8Array(bytes)], { type: 'application/pdf' }), mimeType }
        : original
    }
  } catch (error) {
    logger.warn('[documents] could not reduce file size; keeping the original:', error)
  }
  return original
}

/**
 * Adds accepted files to the current project as document assets. Large photos are optimized
 * on the way in; `options.reduce` also reduces PDFs, for files that did not fit the budget.
 */
export async function addProjectDocumentFiles(
  files: readonly File[],
  options: { reduce?: Exclude<DocumentCompressionLevel, 'auto'> } = {}
): Promise<{ addedIds: string[]; rejected: RejectedProjectDocumentFiles }> {
  const rejected: RejectedProjectDocumentFiles = { unsupported: [], tooLarge: [], overBudget: [] }
  const accepted: Array<{ file: File; prepared: PreparedFile }> = []
  let usedBytes = currentDocumentsStorageBytes()
  for (const file of files) {
    const check = checkDocumentFile(file)
    if (!check.ok) {
      rejected[check.reason].push(file)
      continue
    }
    const prepared = await prepareDocumentFile(file, check.mimeType, check.kind, options.reduce)
    if (usedBytes + prepared.blob.size > PROJECT_DOCUMENTS_STORAGE_LIMIT_BYTES) {
      rejected.overBudget.push(file)
    } else {
      usedBytes += prepared.blob.size
      accepted.push({ file, prepared })
    }
  }

  const addedAt = new Date().toISOString()
  const assets = await Promise.all(
    accepted.map(async ({ file, prepared }) =>
      createProjectDocumentAsset({
        id: `document-${createUuid()}`,
        fileName: file.name,
        mimeType: prepared.mimeType,
        dataUrl: await readFileAsDataUrl(prepared.blob, prepared.mimeType),
        sizeBytes: prepared.blob.size,
        addedAt,
      })
    )
  )
  useProjectStore.getState().upsertProjectAssets(assets)
  return { addedIds: assets.map((asset) => asset.id), rejected }
}

/**
 * Copies a team library file into the current project as an ordinary upload that remembers its
 * library source. The copy counts toward the project budget like any other file.
 */
export async function addTeamLibraryDocumentToProject(input: {
  file: Blob
  name: string
  mimeType: string
  category: ProjectDocumentCategory
  teamDocumentId: string
}): Promise<{ id: string } | { rejected: keyof RejectedProjectDocumentFiles }> {
  const kind = getProjectDocumentKind(input.mimeType, input.name)
  if (!kind) return { rejected: 'unsupported' }
  if (input.file.size > MAX_PROJECT_DOCUMENT_BYTES) return { rejected: 'tooLarge' }
  if (currentDocumentsStorageBytes() + input.file.size > PROJECT_DOCUMENTS_STORAGE_LIMIT_BYTES) {
    return { rejected: 'overBudget' }
  }
  const asset = createProjectDocumentAsset({
    id: `document-${createUuid()}`,
    fileName: input.name,
    mimeType: input.mimeType,
    dataUrl: await readFileAsDataUrl(input.file, input.mimeType),
    sizeBytes: input.file.size,
    addedAt: new Date().toISOString(),
    category: input.category,
    teamDocumentId: input.teamDocumentId,
  })
  useProjectStore.getState().upsertProjectAssets([asset])
  return { id: asset.id }
}

/**
 * Replaces an uploaded document's file, keeping its links, category, and export choice.
 * Returns the rejection reason when the file is not accepted.
 */
export async function replaceProjectDocumentFile(
  documentId: string,
  file: File
): Promise<keyof RejectedProjectDocumentFiles | null> {
  const check = checkDocumentFile(file)
  if (!check.ok) return check.reason
  const existing = getProjectDocuments(useProjectStore.getState().currentProject?.assets).find(
    (document) => document.id === documentId
  )
  const usedByOthers =
    currentDocumentsStorageBytes() - (existing ? getProjectDocumentSizeBytes(existing) : 0)
  const prepared = await prepareDocumentFile(file, check.mimeType, check.kind)
  if (usedByOthers + prepared.blob.size > PROJECT_DOCUMENTS_STORAGE_LIMIT_BYTES) return 'overBudget'
  const dataUrl = await readFileAsDataUrl(prepared.blob, prepared.mimeType)
  const project = useProjectStore.getState()
  const asset = getProjectDocumentReplacementAsset(project.currentProject?.assets ?? [], documentId, {
    fileName: file.name,
    mimeType: prepared.mimeType,
    dataUrl,
    sizeBytes: prepared.blob.size,
  })
  if (asset) project.upsertProjectAssets([asset])
  return null
}

function dataUrlToBytes(dataUrl: string): Uint8Array {
  const binary = atob(dataUrl.slice(dataUrl.indexOf(',') + 1))
  return Uint8Array.from(binary, (char) => char.charCodeAt(0))
}

/**
 * Deletes pages from an uploaded PDF in one step, shrinking the file. The page selection for
 * export follows the renumbered pages; undo restores the previous file.
 */
export async function deleteProjectDocumentPages(
  documentId: string,
  pageNumbers: readonly number[]
): Promise<void> {
  const project = useProjectStore.getState()
  const asset = project.currentProject?.assets.find(
    (candidate) => candidate.id === documentId && isProjectDocumentAsset(candidate)
  )
  if (!asset?.dataUrl || asset.document?.sourceAssetId) return
  const { bytes, pageCount } = await deletePdfPages(dataUrlToBytes(asset.dataUrl), pageNumbers)
  const mimeType = asset.mimeType ?? 'application/pdf'
  // Another edit may have landed while the PDF was rebuilt; write onto the latest asset.
  const latest = useProjectStore.getState().currentProject?.assets.find(({ id }) => id === documentId)
  if (!latest || latest.dataUrl !== asset.dataUrl) return
  useProjectStore.getState().upsertProjectAssets([
    {
      ...latest,
      dataUrl: `data:${mimeType};base64,${bytesToBase64(bytes)}`,
      sizeBytes: bytes.byteLength,
      document: {
        ...latest.document,
        exportPages: exportPagesAfterPagesDeletion(
          latest.document?.exportPages,
          pageNumbers,
          pageCount
        ),
      },
    },
  ])
}

export function deleteProjectDocumentPage(documentId: string, pageNumber: number): Promise<void> {
  return deleteProjectDocumentPages(documentId, [pageNumber])
}

/**
 * Reduces an uploaded document in place, keeping its name, links, and export choice. Nothing
 * changes when the result would not be smaller. Undo restores the previous file.
 */
export async function reduceProjectDocumentSize(
  documentId: string,
  level: Exclude<DocumentCompressionLevel, 'auto'>
): Promise<{ changed: boolean; beforeBytes: number; afterBytes: number }> {
  const asset = useProjectStore
    .getState()
    .currentProject?.assets.find((candidate) => candidate.id === documentId && isProjectDocumentAsset(candidate))
  if (!asset?.dataUrl || asset.document?.sourceAssetId) throw new Error('Not an uploaded document')
  const original = new Blob([new Uint8Array(dataUrlToBytes(asset.dataUrl))], {
    type: asset.mimeType ?? 'application/octet-stream',
  })
  const kind = getProjectDocumentKind(original.type, asset.sourceName ?? '')
  if (!kind) throw new Error('Unsupported document type')
  const prepared = await prepareDocumentFile(original, original.type, kind, level)
  const beforeBytes = original.size
  if (prepared.blob === original) return { changed: false, beforeBytes, afterBytes: beforeBytes }

  const dataUrl = await readFileAsDataUrl(prepared.blob, prepared.mimeType)
  // Another edit may have landed while reducing; write onto the latest asset.
  const latest = useProjectStore.getState().currentProject?.assets.find(({ id }) => id === documentId)
  if (!latest || latest.dataUrl !== asset.dataUrl) {
    return { changed: false, beforeBytes, afterBytes: beforeBytes }
  }
  useProjectStore.getState().upsertProjectAssets([
    { ...latest, mimeType: prepared.mimeType, dataUrl, sizeBytes: prepared.blob.size },
  ])
  return { changed: true, beforeBytes, afterBytes: prepared.blob.size }
}

export function updateProjectDocument(documentId: string, patch: ProjectDocumentPatch): void {
  const project = useProjectStore.getState()
  const assets = project.currentProject?.assets
  if (!assets) return
  const asset = getProjectDocumentPatchAsset(assets, documentId, patch)
  if (asset) project.upsertProjectAssets([asset])
}

/** Redraws a placed floor plan: dark-mode adaptation and, for vector plans, colour or greyscale. */
export function setFloorPlanDocumentDisplay(
  documentId: string,
  patch: FloorPlanDocumentDisplayPatch
): void {
  const project = useProjectStore.getState()
  const assets = project.currentProject?.assets
  if (!assets) return
  const updated = getFloorPlanDocumentDisplayAssets(assets, documentId, patch)
  if (updated.length > 0) project.upsertProjectAssets(updated)
}

/** Floors showing a floor-plan document, for the removal warning; null for other documents. */
export function getFloorPlanDocumentFloors(documentId: string): Array<{ id: string; name?: string }> | null {
  const project = useProjectStore.getState().currentProject
  if (!project) return null
  return getFloorPlanDocumentUsage(project.assets, project.building.floors, documentId)?.floors ?? null
}

/**
 * Removes an uploaded document, or a floor plan together with its place on the situation plan
 * (one undo step). Imported diagram sources stay.
 */
export function removeProjectDocument(documentId: string): void {
  const project = useProjectStore.getState()
  const current = project.currentProject
  if (!current) return
  const asset = current.assets.find(({ id }) => id === documentId)
  if (asset && isProjectDocumentAsset(asset)) {
    project.removeProjectAssets([documentId])
  } else {
    const usage = getFloorPlanDocumentUsage(current.assets, current.building.floors, documentId)
    if (!usage) return
    project.removeFloorPlan({
      planAssetId: usage.planAssetId,
      floorIds: usage.floors.map((floor) => floor.id),
    })
  }
  const currentDocuments = useProjectDocumentsStore.getState()
  if (currentDocuments.openDocumentId === documentId) currentDocuments.openDocument(null)
}
