import React, { useCallback } from 'react'
import ScaleRulerCanvas from '@/components/plan/ScaleRulerCanvas'
import type { ProjectState } from '@/stores/projectStore'
import type { Floor, Point2 } from '@/types/schema'
import { planImageLocalToScenePoint } from '@/lib/plan/planImageRotation'

export function PlanScaleRulerCanvasLayer({
  activeFloorId,
  getFloorById,
  handleScaleRulerCancel,
  handleScaleRulerComplete,
  isResettingScale,
  planImage,
  planImagePosition,
  scaleRulerCommitSignal,
  scaleRulerMeters,
  setScaleRulerMeters,
  setScaleRulerMetersInput,
  setScaleRulerPoints,
  zoom,
}: {
  activeFloorId: string | null
  getFloorById: ProjectState['getFloorById']
  handleScaleRulerCancel: () => void
  handleScaleRulerComplete: (p1: Point2, p2: Point2, meters: number) => void
  isResettingScale: boolean
  planImage: unknown
  planImagePosition: Point2
  scaleRulerCommitSignal: number
  scaleRulerMeters: number | null
  setScaleRulerMeters: React.Dispatch<React.SetStateAction<number | null>>
  setScaleRulerMetersInput: React.Dispatch<React.SetStateAction<string>>
  setScaleRulerPoints: React.Dispatch<
    React.SetStateAction<{
      p1: Point2 | null
      p2: Point2 | null
    }>
  >
  zoom: number
}) {
  const onPointsChange = useCallback((p1: Point2 | null, p2: Point2 | null) => setScaleRulerPoints({ p1, p2 }), [setScaleRulerPoints])
  if (!isResettingScale) return null
  const activeFloorForScale: Floor | null = activeFloorId
    ? (getFloorById(activeFloorId) ?? null)
    : null
  const reference = activeFloorForScale?.scale?.reference
  const existingReferenceLocal = reference && !activeFloorForScale?.planScaleNeedsCalibration && (!reference.floorId || reference.floorId === activeFloorId) ? reference : null
  const hasPlanImageAsset = Boolean(activeFloorForScale?.planAsset || activeFloorForScale?.planImportAsset)
  const existingReferenceWorld = !existingReferenceLocal
    ? null
    : planImage
      ? {
          p1: planImageLocalToScenePoint(
            existingReferenceLocal.p1,
            planImagePosition,
            activeFloorForScale?.planImageRotationDeg ?? 0
          ),
          p2: planImageLocalToScenePoint(
            existingReferenceLocal.p2,
            planImagePosition,
            activeFloorForScale?.planImageRotationDeg ?? 0
          ),
          meters: existingReferenceLocal.meters,
        }
      : !hasPlanImageAsset
        ? existingReferenceLocal
        : null
  const rulerKey = existingReferenceLocal
    ? `scale-${activeFloorForScale?.id}-${existingReferenceLocal.meters}-${existingReferenceLocal.p1.x}-${existingReferenceLocal.p1.y}-${existingReferenceLocal.p2.x}-${existingReferenceLocal.p2.y}`
    : `scale-${activeFloorForScale?.id}-none`

  return (
    <ScaleRulerCanvas
      key={rulerKey}
      onComplete={handleScaleRulerComplete}
      onCancel={handleScaleRulerCancel}
      initialReference={existingReferenceWorld}
      onPointsReady={(startPoint: Point2, endPoint: Point2, meters: number) => {
        setScaleRulerPoints({
          p1: { x: startPoint.x, y: startPoint.y },
          p2: { x: endPoint.x, y: endPoint.y },
        })
        const resolvedMeters = scaleRulerMeters ?? meters
        setScaleRulerMeters(resolvedMeters)
        setScaleRulerMetersInput(Number.isFinite(resolvedMeters) ? String(resolvedMeters) : '')
      }}
      onPointsChange={onPointsChange}
      meters={scaleRulerMeters ?? Number.NaN}
      onMetersChange={(meters: number) => {
        setScaleRulerMeters(meters)
        setScaleRulerMetersInput(String(meters))
      }}
      commitSignal={scaleRulerCommitSignal}
      zoom={zoom}
    />
  )
}
