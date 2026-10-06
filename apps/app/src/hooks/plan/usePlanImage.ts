import { useState, useEffect, useCallback, useRef } from 'react'
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

export function resolvePlanImageDataUrls(activeFloor: Floor | null): {
  sourceDataUrl: string | undefined
  processedDataUrl: string | undefined
} {
  const canonicalAsset = activeFloor?.planImportAsset
  const processedDataUrl =
    canonicalAsset?.processedDataUrl ?? activeFloor?.planAssetProcessed

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
  const activeFloorIdRef = useRef<string | null>(null)
  activeFloorIdRef.current = activeFloor?.id ?? null

  const [planImage, setPlanImage] = useState<HTMLImageElement | null>(null)
  const [planImagePosition, setPlanImagePosition] = useState<{ x: number; y: number }>({ x: 0, y: 0 })

  useEffect(() => {
    const id = activeFloor?.id
    if (!id) {
      setPlanImagePosition({ x: 0, y: 0 })
      return
    }
    const persistedOffset = activeFloor?.planImageOffset
    const saved = useProjectStore.getState().planCanvasPlanImageOffsetByFloorId[id]
    setPlanImagePosition(persistedOffset ?? saved ?? { x: 0, y: 0 })
  }, [activeFloor?.id, activeFloor?.planImageOffset])

  const canonicalAsset = activeFloor?.planImportAsset
  const {
    sourceDataUrl: planImageDataUrl,
    processedDataUrl: planImageProcessedDataUrl,
  } = resolvePlanImageDataUrls(activeFloor)
  const hasWhiteBackground = canonicalAsset?.hasWhiteBackground ?? activeFloor?.planAssetHasWhiteBackground ?? false
  const darkModeAware = canonicalAsset?.darkModeAware ?? hasWhiteBackground
  const svgContent = importedPlanAssetUsesSvgContent(canonicalAsset?.kind)
    ? canonicalAsset?.svgContent
    : undefined
  const grayscale = canonicalAsset?.grayscale === true

  // Load image when plan asset changes
  useEffect(() => {
    if (!planImageDataUrl && !svgContent) {
      setPlanImage(null)
      return
    }

    let cancelled = false

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
          setPlanImage(img)
          // Check if there's already a plan image on this floor
          const floorId = activeFloorIdRef.current
          const floor = floorId ? useProjectStore.getState().getFloorById(floorId) : undefined
          const hasExistingImage = floor?.planAsset || floor?.planImportAsset
          if (!hasExistingImage) {
            // Center the image
            setPlanImagePosition({ x: 0, y: 0 })
            if (floorId) useProjectStore.getState().updateFloor(floorId, { planImageOffset: { x: 0, y: 0 } })
            if (floorId) useProjectStore.getState().setPlanCanvasPlanImageOffset(floorId, { x: 0, y: 0 })
            // Auto-fit to view when image is loaded
            setTimeout(() => {
              canvasRef.current?.fitToView()
            }, 100)
          }
        }
        img.onerror = () => {
          if (cancelled) return
          logger.error('Failed to load plan image')
          setPlanImage(null)
        }
        img.src = imageUrlToUse
      } catch (error) {
        logger.error('Failed to process plan image:', error)
        // Fallback to original image
        const img = new window.Image()
        img.onload = () => {
          if (cancelled) return
          setPlanImage(img)
          const floorId = activeFloorIdRef.current
          const floor = floorId ? useProjectStore.getState().getFloorById(floorId) : undefined
          const hasExistingImage = floor?.planAsset || floor?.planImportAsset
          if (!hasExistingImage) {
            setPlanImagePosition({ x: 0, y: 0 })
            if (floorId) useProjectStore.getState().updateFloor(floorId, { planImageOffset: { x: 0, y: 0 } })
            if (floorId) useProjectStore.getState().setPlanCanvasPlanImageOffset(floorId, { x: 0, y: 0 })
            setTimeout(() => {
              canvasRef.current?.fitToView()
            }, 100)
          }
        }
        img.src = planImageDataUrl ?? ''
      }
    }

    loadImage()
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

  const setPlanImagePositionPersisted = useCallback((update: React.SetStateAction<{ x: number; y: number }>) => {
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
    store.withSingleUndoEntry(() => {
      store.updateFloor(id, { planImageOffset: { x: next.x, y: next.y } })
      return true
    })
    setPlanImagePosition(next)
  }, [])

  return {
    planImage,
    planImagePosition,
    setPlanImagePosition: setPlanImagePositionPersisted,
  }
}
