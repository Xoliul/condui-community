import { useState, useEffect } from 'react'
import {
  applyDarkModeInversion,
  grayscaleSvgColors,
  invertSvgForDarkMode,
} from '@/utils/planImageProcessing'
import { importedPlanAssetUsesSvgContent, type Floor } from '@/types/schema'
import { logger } from '@/lib/logger'

/**
 * Loads the floor plan bitmap for a floor (same pipeline as usePlanImage), without position state.
 * Used for reference underlays of non-active floors.
 *
 * `themeMode` must be passed from a DOM ancestor — do not subscribe to settings store inside
 * react-konva nodes (causes infinite update loops on touch devices).
 */
export function usePlanImageBitmap(
  floor: Floor | null,
  themeMode: 'light' | 'dark'
): HTMLImageElement | null {
  const [img, setImg] = useState<HTMLImageElement | null>(null)

  const canonicalAsset = floor?.planImportAsset
  const planImageDataUrl = canonicalAsset?.dataUrl ?? floor?.planAsset
  const planImageProcessedDataUrl = canonicalAsset?.processedDataUrl ?? floor?.planAssetProcessed
  const hasWhiteBackground = canonicalAsset?.hasWhiteBackground ?? floor?.planAssetHasWhiteBackground ?? false
  const darkModeAware = canonicalAsset?.darkModeAware ?? hasWhiteBackground
  const svgContent = importedPlanAssetUsesSvgContent(canonicalAsset?.kind)
    ? canonicalAsset?.svgContent
    : undefined
  const grayscale = canonicalAsset?.grayscale === true

  useEffect(() => {
    if (!planImageDataUrl && !svgContent) {
      setImg(null)
      return
    }

    let cancelled = false

    const loadImage = async () => {
      try {
        let imageUrlToUse = planImageDataUrl ?? ''
        if (svgContent) {
          let svgToUse = grayscale ? grayscaleSvgColors(svgContent) : svgContent
          if (themeMode === 'dark' && darkModeAware) {
            svgToUse = await invertSvgForDarkMode(svgContent)
          }
          imageUrlToUse = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svgToUse)}`
        } else if (
          themeMode === 'dark' &&
          darkModeAware &&
          canonicalAsset?.kind === 'pdf-raster' &&
          planImageDataUrl
        ) {
          // Keep the PDF page opaque while inverting it so the page's white
          // paper becomes dark instead of showing the canvas through it.
          imageUrlToUse = await applyDarkModeInversion(planImageDataUrl)
        } else if (hasWhiteBackground && planImageProcessedDataUrl) {
          imageUrlToUse = planImageProcessedDataUrl
          if (themeMode === 'dark' && darkModeAware) {
            imageUrlToUse = await applyDarkModeInversion(planImageProcessedDataUrl)
          }
        } else if (themeMode === 'dark' && darkModeAware && planImageDataUrl) {
          // Transparent PDF rasters have no separate processed bitmap. Invert
          // only their painted pixels; the pixel operation preserves alpha.
          imageUrlToUse = await applyDarkModeInversion(planImageDataUrl)
        }

        const image = new window.Image()
        image.onload = () => {
          if (!cancelled) setImg(image)
        }
        image.onerror = () => {
          if (cancelled) return
          logger.error('Failed to load plan image (overlay)')
          setImg(null)
        }
        image.src = imageUrlToUse
      } catch (error) {
        logger.error('Failed to process plan image (overlay):', error)
        const image = new window.Image()
        image.onload = () => {
          if (!cancelled) setImg(image)
        }
        image.onerror = () => {
          if (!cancelled) setImg(null)
        }
        image.src = planImageDataUrl ?? ''
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
    themeMode,
    floor?.id,
  ])

  return img
}
