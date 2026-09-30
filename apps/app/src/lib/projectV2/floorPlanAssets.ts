import type { AssetModelV2 } from '@/types/projectV2'
import { isProjectDocumentAsset } from '@/lib/projectV2/documentAssets'

const FLOOR_PLAN_ASSET_KINDS = new Set<AssetModelV2['kind']>([
  'floorplan-source',
  'floorplan-processed',
  'floorplan-vector',
])

export function isFloorPlanImageAsset(asset: Pick<AssetModelV2, 'kind'>): boolean {
  return FLOOR_PLAN_ASSET_KINDS.has(asset.kind)
}

/** Source, processed, and vector variants of one plan import share this key. */
export function floorPlanImportKey(asset: AssetModelV2): string {
  return asset.legacy?.id ?? asset.id.replace(/-processed$/, '')
}

/** Every floor-plan asset from the same import as `planAssetId`, including itself. */
export function getFloorPlanImportAssetIds(
  assets: readonly AssetModelV2[],
  planAssetId: string
): string[] {
  const plan = assets.find((asset) => asset.id === planAssetId && isFloorPlanImageAsset(asset))
  if (!plan) return []
  const key = floorPlanImportKey(plan)
  return assets
    .filter((asset) => isFloorPlanImageAsset(asset) && floorPlanImportKey(asset) === key)
    .map((asset) => asset.id)
}

type FloorPlanReference = { id: string; planAssetId?: string; processedPlanAssetId?: string }

/** Floors whose plan is one of `assetIds`. */
export function getFloorsShowingPlanAssets<T extends FloorPlanReference>(
  floors: readonly T[],
  assetIds: ReadonlySet<string>
): T[] {
  return floors.filter(
    (floor) =>
      (floor.planAssetId !== undefined && assetIds.has(floor.planAssetId)) ||
      (floor.processedPlanAssetId !== undefined && assetIds.has(floor.processedPlanAssetId))
  )
}

/**
 * Assets to delete once a plan import is no longer shown on any floor: its image variants and
 * any document entry annotating them. Empty while another floor still shows the plan.
 */
export function getUnusedFloorPlanAssetIds(
  assets: readonly AssetModelV2[],
  floors: readonly FloorPlanReference[],
  planAssetId: string
): string[] {
  const group = getFloorPlanImportAssetIds(assets, planAssetId)
  const groupIds = new Set(group)
  if (group.length === 0 || getFloorsShowingPlanAssets(floors, groupIds).length > 0) return []
  const annotations = assets
    .filter(
      (asset) =>
        isProjectDocumentAsset(asset) &&
        asset.document?.sourceAssetId !== undefined &&
        groupIds.has(asset.document.sourceAssetId)
    )
    .map((asset) => asset.id)
  return [...group, ...annotations]
}
