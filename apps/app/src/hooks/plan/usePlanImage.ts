import { useState, useEffect, useLayoutEffect, useCallback, useMemo, useRef } from 'react'
import { withCadDisplayLineWeight } from '@/lib/plan/cadLineWeight'
import { useSettingsStore } from '@/stores/settingsStore'
import { useProjectStore } from '@/stores/projectStore'
import {
  applyDarkModeInversion,
  grayscaleSvgColors,
  invertSvgForDarkMode,
} from '@/utils/planImageProcessing'
import { importedPlanAssetUsesSvgContent, type Floor } from '@/types/schema'
import { logger } from '@/lib/logger'
import { flushPendingProjectHistory } from '@/stores/slices/projectStoreHistory'
import { runProjectCommand } from '@/stores/liveProjectCommandSession'

export function resolvePlanImageDataUrls(activeFloor: Floor | null): {
  sourceDataUrl: string | undefined
  processedDataUrl: string | undefined
} {
  const canonicalAsset = activeFloor?.planImportAsset
  const processedDataUrl = canonicalAsset?.processedDataUrl ?? activeFloor?.planAssetProcessed

  return {
    // Persistence may omit a redundant raster source when the processed bitmap is canonical.
    sourceDataUrl: canonicalAsset?.dataUrl ?? activeFloor?.planAsset ?? processedDataUrl,
    processedDataUrl,
  }
}

/**
 * Hook to load and manage plan image with dark mode inversion
 */
export function usePlanImage(
  activeFloor: Floor | null,
  canvasRef: React.RefObject<{ fitToView: () => void } | null>
) {
  const theme = useSettingsStore((state) => state.theme)
  const activeFloorId = activeFloor?.id ?? null
  const activeFloorIdRef = useRef(activeFloorId)
  useLayoutEffect(() => {
    activeFloorIdRef.current = activeFloorId
  }, [activeFloorId])

  const persistedOffset = activeFloor?.planImageOffset
  const savedOffset = useProjectStore((state) =>
    activeFloorId ? state.planCanvasPlanImageOffsetByFloorId[activeFloorId] : undefined
  )
  const [positionSource, setPositionSource] = useState({ activeFloorId, persistedOffset })

  // The bitmap is tagged with the floor it was loaded for. A floor switch must never keep
  // showing (or exporting) the previous floor's plan while the new one is still loading.
  const [loadedPlan, setLoadedPlan] = useState<{
    image: HTMLImageElement
    floorId: string | null
  } | null>(null)
  const planImage = loadedPlan && loadedPlan.floorId === activeFloorId ? loadedPlan.image : null
  const [planImagePosition, setPlanImagePosition] = useState(
    () => persistedOffset ?? savedOffset ?? { x: 0, y: 0 }
  )
  if (positionSource.activeFloorId !== activeFloorId || positionSource.persistedOffset !== persistedOffset) {
    setPositionSource({ activeFloorId, persistedOffset })
    setPlanImagePosition(persistedOffset ?? savedOffset ?? { x: 0, y: 0 })
  }

  const canonicalAsset = activeFloor?.planImportAsset
  const { sourceDataUrl: planImageDataUrl, processedDataUrl: planImageProcessedDataUrl } =
    resolvePlanImageDataUrls(activeFloor)
  const hasWhiteBackground =
    canonicalAsset?.hasWhiteBackground ?? activeFloor?.planAssetHasWhiteBackground ?? false
  const darkModeAware = canonicalAsset?.darkModeAware ?? hasWhiteBackground
  const rawSvgContent = importedPlanAssetUsesSvgContent(canonicalAsset?.kind)
    ? canonicalAsset?.svgContent
    : undefined
  const cadAssetWidth = canonicalAsset?.width
  const isCadAsset = canonicalAsset?.cadReference != null
  const svgContent = useMemo(
    () =>
      rawSvgContent && cadAssetWidth != null
        ? withCadDisplayLineWeight(rawSvgContent, {
            width: cadAssetWidth,
            cadReference: isCadAsset || undefined,
          })
        : rawSvgContent,
    [rawSvgContent, cadAssetWidth, isCadAsset]
  )
  const grayscale = canonicalAsset?.grayscale === true
  if (!planImageDataUrl && !svgContent && loadedPlan !== null) setLoadedPlan(null)

  // Load image when plan asset changes
  useEffect(() => {
    if (!planImageDataUrl && !svgContent) return

    let cancelled = false
    const loadFloorId = activeFloor?.id ?? null

    const loadImage = async () => {
      try {
        // Determine which image URL to use
        let imageUrlToUse = planImageDataUrl ?? ''
        if (svgContent) {
          let svgToUse = grayscale ? grayscaleSvgColors(svgContent) : svgContent
          if (theme.mode === 'dark' && darkModeAware) {
            svgToUse = await invertSvgForDarkMode(svgContent)
          }
          imageUrlToUse = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svgToUse)}`
        } else if (hasWhiteBackground && planImageProcessedDataUrl) {
          // A detected white page (PDF page or scanned/photographed plan) is removed, rooms
          // included, so in dark mode only the inverted linework shows on the canvas.
          // If we have a processed version and it has white background, use that.
          imageUrlToUse = planImageProcessedDataUrl

          // If dark mode support is enabled, apply inversion to the processed image.
          if (theme.mode === 'dark' && darkModeAware) {
            imageUrlToUse = await applyDarkModeInversion(planImageProcessedDataUrl)
          }
        } else if (theme.mode === 'dark' && darkModeAware && planImageDataUrl) {
          // Transparent PDF rasters have no separate processed bitmap. Invert
          // only their painted pixels; the pixel operation preserves alpha.
          imageUrlToUse = await applyDarkModeInversion(planImageDataUrl)
        }

        // Load the final image
        const img = new window.Image()
        img.onload = () => {
          if (cancelled) return
          setLoadedPlan({ image: img, floorId: loadFloorId })
          // Check if there's already a plan image on this floor
          const floorId = activeFloorIdRef.current
          const floor = floorId ? useProjectStore.getState().getFloorById(floorId) : undefined
          const hasExistingImage = floor?.planAsset || floor?.planImportAsset
          if (!hasExistingImage) {
            // Center the image
            setPlanImagePosition({ x: 0, y: 0 })
            if (floorId)
              runProjectCommand('plan.transformBackground', { floorId, offset: { x: 0, y: 0 } })
            if (floorId)
              useProjectStore.getState().setPlanCanvasPlanImageOffset(floorId, { x: 0, y: 0 })
            // Auto-fit to view when image is loaded
            setTimeout(() => {
              canvasRef.current?.fitToView()
            }, 100)
          }
        }
        img.onerror = () => {
          if (cancelled) return
          logger.error('Failed to load plan image')
          setLoadedPlan(null)
        }
        img.src = imageUrlToUse
      } catch (error) {
        logger.error('Failed to process plan image:', error)
        // Fallback to original image
        const img = new window.Image()
        img.onload = () => {
          if (cancelled) return
          setLoadedPlan({ image: img, floorId: loadFloorId })
          const floorId = activeFloorIdRef.current
          const floor = floorId ? useProjectStore.getState().getFloorById(floorId) : undefined
          const hasExistingImage = floor?.planAsset || floor?.planImportAsset
          if (!hasExistingImage) {
            setPlanImagePosition({ x: 0, y: 0 })
            if (floorId)
              runProjectCommand('plan.transformBackground', { floorId, offset: { x: 0, y: 0 } })
            if (floorId)
              useProjectStore.getState().setPlanCanvasPlanImageOffset(floorId, { x: 0, y: 0 })
            setTimeout(() => {
              canvasRef.current?.fitToView()
            }, 100)
          }
        }
        img.src = planImageDataUrl ?? ''
      }
    }

    void loadImage()
    return () => {
      cancelled = true
    }
  }, [
    planImageDataUrl,
    planImageProcessedDataUrl,
    hasWhiteBackground,
    darkModeAware,
    canonicalAsset?.kind,
    svgContent,
    grayscale,
    theme.mode,
    activeFloor?.id,
    canvasRef,
  ])

  const setPlanImagePositionPersisted = useCallback(
    (update: React.SetStateAction<{ x: number; y: number }>) => {
      const id = activeFloorIdRef.current
      if (!id) return
      const store = useProjectStore.getState()
      const prev = store.getFloorById(id)?.planImageOffset ??
        store.planCanvasPlanImageOffsetByFloorId[id] ?? { x: 0, y: 0 }
      const next = typeof update === 'function' ? update(prev) : update
      if (next.x === prev.x && next.y === prev.y) return
      // Persist synchronously, outside React's state updater (which may run again).
      // Leave the legacy fallback cache alone: undo may restore an undefined offset.
      flushPendingProjectHistory()
      runProjectCommand('plan.transformBackground', {
        floorId: id,
        offset: { x: next.x, y: next.y },
      })
      setPlanImagePosition(next)
    },
    []
  )

  return {
    planImage,
    planImagePosition,
    setPlanImagePosition: setPlanImagePositionPersisted,
  }
}
