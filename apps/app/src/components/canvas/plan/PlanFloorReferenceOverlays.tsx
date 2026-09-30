import { memo, useMemo } from 'react'
import { Group, Image } from 'react-konva'
import { useProjectStore, type ProjectState } from '@/stores/projectStore'
import { usePlanImageBitmap } from '@/hooks/plan/usePlanImageBitmap'
import { calculatePxPerMeter } from '@/hooks/plan/usePlanScale'
import { PLAN_OTHER_FLOORS_OVERLAY_OPACITY } from '@/constants/planConstants'
import { PLAN_BACKGROUND_FLOOR_ATTR } from '@/lib/plan/graphicElements'
import {
  readLegacyCompatibilityFloors,
  selectProjectFloorPlan,
} from '@/lib/projectV2/buildingFloors'
import type { ThemeWallColors } from '@/types/ui'
import type { PlanVisibilityState } from '@/types/ui'
import { WallRenderer } from './WallRenderer'

const PLAN_CANVAS_FALLBACK_PX_PER_METER = 100
const DEFAULT_PLAN_IMAGE_OFFSET = { x: 0, y: 0 }

const PlanFloorOverlaySingle = memo(function PlanFloorOverlaySingle({
  floorId,
  zoom,
  themeMode,
  targetPxPerMeter,
  planVisibility,
  customWallColors,
}: {
  floorId: string
  zoom: number
  themeMode: 'light' | 'dark'
  targetPxPerMeter: number | null
  planVisibility: PlanVisibilityState
  customWallColors?: ThemeWallColors
}) {
  const currentProject = useProjectStore((s: ProjectState) => s.currentProject)
  const floor = useMemo(
    () =>
      currentProject
        ? (readLegacyCompatibilityFloors(currentProject).find((candidate) => candidate.id === floorId) ??
          null)
        : null,
    [currentProject, floorId]
  )
  const offset = useProjectStore(
    (s: ProjectState) => s.planCanvasPlanImageOffsetByFloorId[floorId] ?? DEFAULT_PLAN_IMAGE_OFFSET,
  )
  const bitmap = usePlanImageBitmap(floor, themeMode)
  if (!floor) return null

  const fp = currentProject ? selectProjectFloorPlan(currentProject, floorId) : floor.floorPlan
  const floorPxPerMeter = calculatePxPerMeter(floor) ?? PLAN_CANVAS_FALLBACK_PX_PER_METER
  const normalizedTargetPxPerMeter = targetPxPerMeter ?? PLAN_CANVAS_FALLBACK_PX_PER_METER
  const overlayScale =
    normalizedTargetPxPerMeter > 0 &&
    floorPxPerMeter > 0
      ? normalizedTargetPxPerMeter / floorPxPerMeter
      : 1

  const hasRaster = !!(floor.planAsset || floor.planImportAsset)
  const showImage = planVisibility.groundPlansVisible && bitmap && hasRaster

  if (!showImage && (!fp || fp.walls.length === 0)) return null

  return (
    <Group
      opacity={PLAN_OTHER_FLOORS_OVERLAY_OPACITY}
      scaleX={overlayScale}
      scaleY={overlayScale}
      listening={false}
    >
      {showImage && bitmap && (
        <Group
          x={offset.x}
          y={offset.y}
          rotation={floor.planImageRotationDeg ?? 0}
          listening={false}
        >
          <Image
            image={bitmap}
            width={bitmap.width}
            height={bitmap.height}
            {...{ [PLAN_BACKGROUND_FLOOR_ATTR]: floorId }}
            listening={false}
            opacity={Math.min(planVisibility.groundPlansOpacity ?? 100, 100) / 100}
          />
        </Group>
      )}
      {fp && fp.walls.length > 0 && (
        <WallRenderer
          walls={fp.walls}
          doors={fp.doors ?? []}
          windows={fp.windows ?? []}
          masterWallThickness={fp.masterWallThickness}
          pxPerMeter={floorPxPerMeter}
          interactionMode="none"
          zoom={zoom}
          listening={false}
          showPointHandles={false}
          showSegmentMeasurements={false}
          theme={themeMode}
          customWallColors={customWallColors}
        />
      )}
    </Group>
  )
})

export function PlanFloorReferenceOverlays({
  overlayFloorIds,
  zoom,
  themeMode,
  targetPxPerMeter,
  planVisibility,
  customWallColors,
}: {
  overlayFloorIds: string[]
  zoom: number
  themeMode: 'light' | 'dark'
  targetPxPerMeter: number | null
  planVisibility: PlanVisibilityState
  customWallColors?: ThemeWallColors
}) {
  return (
    <>
      {overlayFloorIds.map((id) => (
        <PlanFloorOverlaySingle
          key={id}
          floorId={id}
          zoom={zoom}
          themeMode={themeMode}
          targetPxPerMeter={targetPxPerMeter}
          planVisibility={planVisibility}
          customWallColors={customWallColors}
        />
      ))}
    </>
  )
}

export { DEFAULT_PLAN_IMAGE_OFFSET }
