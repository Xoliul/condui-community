import type Konva from 'konva'
import { PLAN_BACKGROUND_FLOOR_ATTR } from '@/lib/plan/graphicElements'
import { useProjectStore } from '@/stores/projectStore'

export function isFloorPlanBackgroundDarkModeAware(floorId: string): boolean {
  const floor = useProjectStore.getState().getFloorById(floorId)
  if (!floor) return false

  const canonicalAsset = floor.planImportAsset
  const hasWhiteBackground =
    canonicalAsset?.hasWhiteBackground ?? floor.planAssetHasWhiteBackground ?? false
  return canonicalAsset?.darkModeAware ?? hasWhiteBackground
}

export function getPlanBackgroundFloorId(node: Konva.Node): string | undefined {
  const value = node.getAttr(PLAN_BACKGROUND_FLOOR_ATTR)
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

/** True when the floor has an imported plan that the canvas should be drawing behind it. */
export function floorExpectsPlanBackground(floorId: string): boolean {
  const floor = useProjectStore.getState().getFloorById(floorId)
  if (!floor) return false
  const asset = floor.planImportAsset
  return Boolean(asset?.dataUrl || asset?.processedDataUrl || asset?.svgContent || floor.planAsset)
}

/** True when the stage currently draws a plan background that was loaded for this floor. */
export function stageHasPlanBackgroundForFloor(stage: Konva.Stage, floorId: string): boolean {
  return stage.findOne((node: Konva.Node) => getPlanBackgroundFloorId(node) === floorId) != null
}
