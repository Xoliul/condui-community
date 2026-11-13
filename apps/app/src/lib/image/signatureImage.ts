import { enhanceScanGray, rgbaToScanGray, SCAN_TONE_MAX_DIMENSION } from '@/utils/scanImageTone'

/** Choose from the pixels, never the filename: PNGs can contain photographed paper too. */
export function detectSignatureBackground(
  rgba: Uint8ClampedArray,
  width: number,
  height: number,
): 'transparent' | 'white-paper' | 'scan' {
  let transparent = 0, white = 0, borderWhite = 0, borderPixels = 0
  const margin = Math.max(1, Math.round(Math.min(width, height) * 0.05))
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const offset = (y * width + x) * 4
      const alpha = rgba[offset + 3]!
      if (alpha < 16) transparent += 1
      const isWhite = alpha >= 240 && Math.min(rgba[offset]!, rgba[offset + 1]!, rgba[offset + 2]!) >= 245
      if (isWhite) white += 1
      if (x < margin || y < margin || x >= width - margin || y >= height - margin) {
        borderPixels += 1
        if (isWhite) borderWhite += 1
      }
    }
  }
  const total = width * height
  // Even a tightly cropped transparent signature should retain its supplied alpha mask.
  // A little transparency around a predominantly painted page is still paper to remove.
  if (transparent >= Math.max(1, total * 0.01) && white < total * 0.5) return 'transparent'
  if (white >= total * 0.9 && borderWhite >= borderPixels * 0.98) return 'white-paper'
  return 'scan'
}

/** Extract an antialiased ink mask; genuine transparent artwork already supplies its mask. */
export function signatureInkPixels(
  rgba: Uint8ClampedArray,
  width: number,
  height: number,
  isDark: boolean,
): Uint8ClampedArray {
  const background = detectSignatureBackground(rgba, width, height)
  const gray = background === 'transparent' ? null : rgbaToScanGray(rgba, width, height)
  const enhanced = gray && (background === 'scan'
    ? enhanceScanGray(gray, { highPass: 1, levels: 1 })
    : gray.values)
  const output = new Uint8ClampedArray(rgba.length)
  for (let pixel = 0, offset = 0; offset < rgba.length; pixel += 1, offset += 4) {
    const ink = isDark ? 235 : 25
    output[offset] = output[offset + 1] = output[offset + 2] = ink
    // Remove residual paper noise without a hard threshold through the stroke edges.
    output[offset + 3] = enhanced
      ? Math.min(rgba[offset + 3]!, Math.max(0, background === 'white-paper'
        ? (250 - enhanced[pixel]!) * 255 / 250
        : (245 - enhanced[pixel]!) * 255 / 225))
      : rgba[offset + 3]!
  }
  return output
}

function loadImage(source: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image()
    image.onload = () => resolve(image)
    image.onerror = () => reject(new Error('Failed to load signature'))
    image.src = source
  })
}

const cache = new Map<string, Promise<HTMLImageElement>>()

/** Shared by canvas, previews and PDF export. Originals remain untouched in project/profile storage. */
export function prepareSignatureImage(source: string, isDark: boolean): Promise<HTMLImageElement> {
  const key = `${isDark}:${source}`
  const cached = cache.get(key)
  if (cached) return cached
  const result = loadImage(source).then(async (image) => {
    try {
      const scale = Math.min(1, SCAN_TONE_MAX_DIMENSION / Math.max(image.naturalWidth, image.naturalHeight))
      const canvas = document.createElement('canvas')
      canvas.width = Math.max(1, Math.round(image.naturalWidth * scale))
      canvas.height = Math.max(1, Math.round(image.naturalHeight * scale))
      const context = canvas.getContext('2d', { willReadFrequently: true })
      if (!context) return image
      context.drawImage(image, 0, 0, canvas.width, canvas.height)
      const pixels = context.getImageData(0, 0, canvas.width, canvas.height)
      pixels.data.set(signatureInkPixels(pixels.data, canvas.width, canvas.height, isDark))
      context.putImageData(pixels, 0, 0)
      return await loadImage(canvas.toDataURL('image/png'))
    } catch {
      return image
    }
  })
  cache.set(key, result)
  // Bound decoded images and source strings; do not retain failed loads.
  if (cache.size > 8) cache.delete(cache.keys().next().value!)
  void result.catch(() => { if (cache.get(key) === result) cache.delete(key) })
  return result
}
