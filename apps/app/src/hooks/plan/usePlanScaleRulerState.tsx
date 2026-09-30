import React, { useCallback, useEffect, useRef, useState } from 'react'
import type { TFunction } from 'i18next'
import type { DialogConfig } from '@/stores/dialogStore'
import type { ProjectState } from '@/stores/projectStore'
import type { Floor, Point2 } from '@/types/schema'
import { calculatePxPerMeter } from './usePlanScale'
import { createPlanScaleReference, resolvePlanPxPerMeter } from '@/lib/plan/planScale'
import { rescaleFloorPlan } from '@/lib/plan/rescalePlan'
import { scenePointToPlanImageLocal } from '@/lib/plan/planImageRotation'

export function usePlanScaleRulerState() {
  const [isResettingScale, setIsResettingScale] = useState(false)
  const [scaleRulerPoints, setScaleRulerPoints] = useState<{
    p1: Point2 | null
    p2: Point2 | null
  }>({ p1: null, p2: null })
  const [scaleRulerMeters, setScaleRulerMeters] = useState<number | null>(null)
  const [scaleRulerMetersInput, setScaleRulerMetersInput] = useState('')
  const [scaleRulerCommitSignal, setScaleRulerCommitSignal] = useState(0)

  return {
    isResettingScale,
    setIsResettingScale,
    scaleRulerPoints,
    setScaleRulerPoints,
    scaleRulerMeters,
    setScaleRulerMeters,
    scaleRulerMetersInput,
    setScaleRulerMetersInput,
    scaleRulerCommitSignal,
    setScaleRulerCommitSignal,
  }
}

type UsePlanScaleResetControllerOptions = {
  activeFloor: Floor | null | undefined
  activeFloorId: string | null
  activeTool: string
  applyPlanRescale: ProjectState['applyPlanRescale']
  cancelResetScaleTrigger: number
  getFloorById: ProjectState['getFloorById']
  getPlacementsByFloor: ProjectState['getPlacementsByFloor']
  openDialog: (config: DialogConfig) => void
  setActiveTool: (tool: 'none' | 'resetScale') => void
  t: TFunction
  updateFloor: ProjectState['updateFloor']
}

export function usePlanScaleResetController({
  activeFloorId,
  activeTool,
  applyPlanRescale,
  cancelResetScaleTrigger,
  getFloorById,
  getPlacementsByFloor,
  openDialog,
  setActiveTool,
  t,
  updateFloor,
}: UsePlanScaleResetControllerOptions) {
  const state = usePlanScaleRulerState()
  const {
    isResettingScale,
    scaleRulerMeters,
    scaleRulerPoints,
    setIsResettingScale,
    setScaleRulerMeters,
    setScaleRulerMetersInput,
    setScaleRulerPoints,
  } = state
  const lastSeenCancelResetScaleTriggerRef = useRef(cancelResetScaleTrigger)

  const tempPxPerMeter =
    isResettingScale &&
    scaleRulerPoints.p1 &&
    scaleRulerPoints.p2 &&
    scaleRulerMeters != null
      ? (() => {
          const { p1, p2 } = scaleRulerPoints
          const meters = scaleRulerMeters!
          const reference = createPlanScaleReference(p1!, p2!, meters)
          return reference ? resolvePlanPxPerMeter({ reference }) : null
        })()
      : null

  const handleResetScaleStart = useCallback(() => {
    const floor = activeFloorId ? getFloorById(activeFloorId) : null
    const reference = floor?.scale?.reference
    const ownsReference = reference && !floor?.planScaleNeedsCalibration && (!reference.floorId || reference.floorId === activeFloorId)
    const initialMeters = scaleRulerMeters ?? (ownsReference ? reference.meters : 1)
    setIsResettingScale(true)
    setScaleRulerPoints({ p1: null, p2: null })
    setScaleRulerMeters(initialMeters)
    setScaleRulerMetersInput(String(initialMeters))
    setActiveTool('resetScale')
  }, [
    activeFloorId,
    getFloorById,
    scaleRulerMeters,
    setActiveTool,
    setIsResettingScale,
    setScaleRulerMeters,
    setScaleRulerMetersInput,
    setScaleRulerPoints,
  ])

  const handleScaleRulerCancel = useCallback(() => {
    setIsResettingScale(false)
    setScaleRulerPoints({ p1: null, p2: null })
    setScaleRulerMeters(null)
    setScaleRulerMetersInput('')
    setActiveTool('none')
  }, [
    setActiveTool,
    setIsResettingScale,
    setScaleRulerMeters,
    setScaleRulerMetersInput,
    setScaleRulerPoints,
  ])

  const handleScaleRulerComplete = useCallback(
    (p1World: Point2, p2World: Point2, meters: number, currentPlanImagePosition: Point2) => {
      if (!activeFloorId) return

      const floorBefore = getFloorById(activeFloorId)
      if (!floorBefore) return
      if (!createPlanScaleReference(p1World, p2World, meters)) return

      setIsResettingScale(false)
      setScaleRulerPoints({ p1: null, p2: null })
      setScaleRulerMeters(null)
      setScaleRulerMetersInput('')
      setActiveTool('none')

      // The reference is drawn inside the (possibly rotated) plan image group.
      const rotationDeg = floorBefore.planImageRotationDeg ?? 0
      const localP1 = scenePointToPlanImageLocal(p1World, currentPlanImagePosition, rotationDeg)
      const localP2 = scenePointToPlanImageLocal(p2World, currentPlanImagePosition, rotationDeg)
      const newScaleReference = createPlanScaleReference(localP1, localP2, meters, activeFloorId)!
      const hasPlanImage = !!(floorBefore.planAsset || floorBefore.planImportAsset)
      const floorPlan = floorBefore.floorPlan
      const hasVectorWalls = !!floorPlan && floorPlan.walls.length > 0
      const oldPxPerMeter = calculatePxPerMeter(floorBefore) ?? 100
      const dx = p2World.x - p1World.x
      const dy = p2World.y - p1World.y
      const distancePx = Math.sqrt(dx * dx + dy * dy)
      const newPxPerMeter = distancePx > 0 && meters > 0 ? distancePx / meters : null

      const shouldAttemptWallRescale =
        hasPlanImage &&
        hasVectorWalls &&
        !floorBefore.planScaleNeedsCalibration &&
        oldPxPerMeter != null &&
        newPxPerMeter != null &&
        newPxPerMeter > 0

      if (!shouldAttemptWallRescale) {
        updateFloor(activeFloorId, { scale: { reference: newScaleReference } })
        return
      }

      const scaleFactor = newPxPerMeter! / oldPxPerMeter!
      if (!Number.isFinite(scaleFactor) || Math.abs(scaleFactor - 1) < 1e-3) {
        updateFloor(activeFloorId, { scale: { reference: newScaleReference } })
        return
      }

      const allPoints: Point2[] = []
      for (const wall of floorPlan!.walls) allPoints.push(...wall.points)
      if (allPoints.length === 0) {
        updateFloor(activeFloorId, { scale: { reference: newScaleReference } })
        setIsResettingScale(false)
        setScaleRulerPoints({ p1: null, p2: null })
        setScaleRulerMeters(null)
        setActiveTool('none')
        return
      }

      let sumX = 0
      let sumY = 0
      for (const point of allPoints) {
        sumX += point.x
        sumY += point.y
      }
      const center = { x: sumX / allPoints.length, y: sumY / allPoints.length }
      const placementsOnFloor = getPlacementsByFloor(activeFloorId)
      const placementsToRescale: Array<{ id: string; pos: Point2 }> = []
      for (const placement of placementsOnFloor) {
        const pos = placement.pos ?? null
        if (!pos) continue
        placementsToRescale.push({ id: placement.id, pos })
      }

      const title = t('plan.resetScale.confirmRescaleTitle')
      const intro = t('plan.resetScale.confirmRescaleIntro', { factor: scaleFactor.toFixed(2) })

      openDialog({
        type: 'custom',
        title,
        content: (
          <div className="text-gray-600 dark:text-gray-400 space-y-3">
            <p>{intro as React.ReactNode}</p>
            <ul className="list-disc pl-5 space-y-1">
              <li>{t('plan.resetScale.optionRescale') as React.ReactNode}</li>
              <li>{t('plan.resetScale.optionKeep') as React.ReactNode}</li>
              <li>{t('plan.resetScale.optionCancel') as React.ReactNode}</li>
            </ul>
          </div>
        ),
        buttons: [
          {
            label: t('common.cancel'),
            variant: 'secondary',
            onClick: () => {
              // Cancel entire operation: keep existing scale and walls untouched.
            },
          },
          {
            label: t('plan.resetScale.confirmRescaleCancel'),
            variant: 'secondary',
            onClick: () => {
              const latestFloor = getFloorById(activeFloorId)
              if (latestFloor) {
                applyPlanRescale(activeFloorId, { scale: { reference: newScaleReference } }, [])
              }
            },
          },
          {
            label: t('plan.resetScale.confirmRescaleConfirm'),
            variant: 'primary',
            autoFocus: true,
            onClick: () => {
              const latestFloor = getFloorById(activeFloorId)
              const latestPlan = latestFloor?.floorPlan
              if (!latestFloor || !latestPlan) return

              const placementUpdates = placementsToRescale.map(({ id, pos }) => ({
                id,
                pos: {
                  x: center.x + (pos.x - center.x) * scaleFactor,
                  y: center.y + (pos.y - center.y) * scaleFactor,
                },
              }))

              applyPlanRescale(
                activeFloorId,
                {
                  scale: { reference: newScaleReference },
                  floorPlan: rescaleFloorPlan(latestPlan, scaleFactor, center),
                },
                placementUpdates,
              )
            },
          },
        ],
      })
    },
    [
      activeFloorId,
      applyPlanRescale,
      getFloorById,
      getPlacementsByFloor,
      openDialog,
      setActiveTool,
      setIsResettingScale,
      setScaleRulerMeters,
      setScaleRulerMetersInput,
      setScaleRulerPoints,
      t,
      updateFloor,
    ],
  )

  useEffect(() => {
    if (cancelResetScaleTrigger === lastSeenCancelResetScaleTriggerRef.current) return
    lastSeenCancelResetScaleTriggerRef.current = cancelResetScaleTrigger
    if (isResettingScale || activeTool === 'resetScale') {
      handleScaleRulerCancel()
    }
  }, [cancelResetScaleTrigger, isResettingScale, activeTool, handleScaleRulerCancel])

  return {
    ...state,
    handleResetScaleStart,
    handleScaleRulerCancel,
    handleScaleRulerComplete,
    tempPxPerMeter,
  }
}
