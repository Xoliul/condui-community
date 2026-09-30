import type { AssetModelV2 } from '@/types/projectV2'

/**
 * Attached project documents are ordinary `assets` entries of this kind. Every edition must
 * preserve them on load and save, even where the Documents canvas itself is unavailable.
 */
export const PROJECT_DOCUMENT_ASSET_KIND = 'document' satisfies AssetModelV2['kind']

export function isProjectDocumentAsset(asset: Pick<AssetModelV2, 'kind'>): boolean {
  return asset.kind === PROJECT_DOCUMENT_ASSET_KIND
}

/**
 * Removes attached documents, keeping only what the drawings need. Used for copies that travel
 * with a deliverable (the editable project inside a PDF, diagnostics, support uploads).
 */
export function withoutProjectDocumentAssets<T extends { assets?: AssetModelV2[] }>(project: T): T {
  if (!project.assets?.some(isProjectDocumentAsset)) return project
  return { ...project, assets: project.assets.filter((asset) => !isProjectDocumentAsset(asset)) }
}
