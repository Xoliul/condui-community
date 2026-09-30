import type { AssetModelV2 } from '@/types/projectV2'
import { getFloorPlanImportAssetIds } from '@/lib/projectV2/floorPlanAssets'
import { svgHasMeaningfulColor } from '@/utils/planImageProcessing'

const DERIVED_DOCUMENT_ID_PREFIX = 'asset:'

/** How a placed floor plan is drawn: adapted to dark mode, and for vector plans in colour or grey. */
export interface FloorPlanDocumentDisplay {
  darkModeAware: boolean
  grayscale: boolean
  /** PDF, DXF and DWG plans are vectors; only they can switch between colour and greyscale. */
  vector: boolean
  /** The stored drawing has colours; plans greyscaled at import by older versions do not. */
  hasColour: boolean
}

export type FloorPlanDocumentDisplayPatch = Partial<
  Pick<FloorPlanDocumentDisplay, 'darkModeAware' | 'grayscale'>
>

function importAssets(assets: readonly AssetModelV2[], documentId: string): AssetModelV2[] {
  if (!documentId.startsWith(DERIVED_DOCUMENT_ID_PREFIX)) return []
  const ids = new Set(
    getFloorPlanImportAssetIds(assets, documentId.slice(DERIVED_DOCUMENT_ID_PREFIX.length))
  )
  return assets.filter((asset) => ids.has(asset.id))
}

/** Display settings of the floor plan a document shows; null for other documents. */
export function getFloorPlanDocumentDisplay(
  assets: readonly AssetModelV2[],
  documentId: string
): FloorPlanDocumentDisplay | null {
  const group = importAssets(assets, documentId)
  if (group.length === 0) return null
  const vectorAsset = group.find((asset) => asset.kind === 'floorplan-vector' && asset.svgContent)
  const primary = vectorAsset ?? group[0]!
  return {
    darkModeAware: primary.darkModeAware ?? primary.legacy?.darkModeAware ?? false,
    grayscale: primary.grayscale ?? primary.legacy?.grayscale ?? false,
    vector: vectorAsset != null,
    hasColour: vectorAsset?.svgContent ? svgHasMeaningfulColor(vectorAsset.svgContent) : false,
  }
}

/** The floor-plan assets of that import with the new display settings applied. */
export function getFloorPlanDocumentDisplayAssets(
  assets: readonly AssetModelV2[],
  documentId: string,
  patch: FloorPlanDocumentDisplayPatch
): AssetModelV2[] {
  return importAssets(assets, documentId).map((asset) => ({
    ...asset,
    ...patch,
    ...(asset.legacy ? { legacy: { ...asset.legacy, ...patch } } : {}),
  }))
}
