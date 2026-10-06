/** Maximum stored dimension for installer logo and signature images (px). */
export const INSTALLER_IMAGE_MAX_PX = 500

/**
 * Normalize an uploaded installer image to a raster data URL whose longest side
 * is at most maxPx. Small raster images are kept as-is. SVG is rasterized to PNG
 * at maxPx: stored assets, the canvas and PDF export then only handle raster
 * images. Resized images stay PNG (keeps transparency) unless the source is JPEG.
 */
export function resizeImageDataUrl(
  dataUrl: string,
  maxPx: number = INSTALLER_IMAGE_MAX_PX
): Promise<string> {
  const isSvg = /^data:image\/svg\+xml[;,]/i.test(dataUrl)
  const isJpeg = /^data:image\/jpe?g[;,]/i.test(dataUrl)
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => {
      // An SVG without width/height has no intrinsic size; draw it as a square.
      const w = img.naturalWidth || maxPx
      const h = img.naturalHeight || maxPx
      if (!isSvg && w <= maxPx && h <= maxPx) {
        resolve(dataUrl)
        return
      }
      const scale = isSvg ? maxPx / Math.max(w, h) : Math.min(1, maxPx / Math.max(w, h))
      const canvas = document.createElement('canvas')
      canvas.width = Math.max(1, Math.round(w * scale))
      canvas.height = Math.max(1, Math.round(h * scale))
      const ctx = canvas.getContext('2d')
      if (!ctx) {
        reject(new Error('Canvas unavailable'))
        return
      }
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
      try {
        resolve(isJpeg ? canvas.toDataURL('image/jpeg', 0.9) : canvas.toDataURL('image/png'))
      } catch (error) {
        reject(error)
      }
    }
    img.onerror = () => reject(new Error('Failed to load image'))
    img.src = dataUrl
  })
}
