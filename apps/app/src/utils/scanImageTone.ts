/**
 * Browser port of the Vision Service's page enhancement
 * (`ai_vision/photo_page_preprocessor.py`, `_enhance` and `_levels`): a high-pass that removes
 * slow illumination changes, CLAHE, and an input-levels stretch. `levels` and `highPass` are the
 * same 0-2 strengths the scan's crop step sends, so the result looks familiar; it is not pixel
 * identical to OpenCV. Optionally the paper becomes transparent so only the ink is drawn.
 */

export interface ScanEnhancement {
  /** Levels stretch strength, 0 to 2 (1 is the service default). */
  levels: number
  /** High-pass strength, 0 to 2 (1 is the service default). */
  highPass: number
}

export interface ScanToneOptions extends ScanEnhancement {
  /** Draw only the ink, in `inkColor`, on a transparent background. */
  transparentPaper: boolean
  inkColor: readonly [number, number, number]
}

export interface ScanGray {
  width: number
  height: number
  values: Uint8ClampedArray
}

/** Longest side processed; larger pages are scaled down first. */
export const SCAN_TONE_MAX_DIMENSION = 2000

const clampByte = (value: number) => (value < 0 ? 0 : value > 255 ? 255 : Math.round(value))

/** Separable box blur run three times, a close approximation of a Gaussian with `sigma`. */
export function approximateGaussianBlur(
  source: Float32Array,
  width: number,
  height: number,
  sigma: number
): Float32Array {
  const radius = Math.max(1, Math.round((Math.sqrt((12 * sigma * sigma) / 3 + 1) - 1) / 2))
  let current = Float32Array.from(source)
  let scratch = new Float32Array(source.length)
  const pass = (input: Float32Array, output: Float32Array, horizontal: boolean) => {
    const lines = horizontal ? height : width
    const length = horizontal ? width : height
    const stride = horizontal ? 1 : width
    for (let line = 0; line < lines; line += 1) {
      const start = horizontal ? line * width : line
      let sum = 0
      // Replicated borders, as OpenCV's default does for the blur.
      for (let k = -radius; k <= radius; k += 1) {
        sum += input[start + Math.min(length - 1, Math.max(0, k)) * stride]!
      }
      for (let i = 0; i < length; i += 1) {
        output[start + i * stride] = sum / (radius * 2 + 1)
        const add = Math.min(length - 1, i + radius + 1)
        const remove = Math.max(0, i - radius)
        sum += input[start + add * stride]! - input[start + remove * stride]!
      }
    }
  }
  for (let iteration = 0; iteration < 3; iteration += 1) {
    pass(current, scratch, true)
    ;[current, scratch] = [scratch, current]
    pass(current, scratch, false)
    ;[current, scratch] = [scratch, current]
  }
  return current
}

/** Contrast-limited adaptive histogram equalization (OpenCV `createCLAHE`). */
export function clahe(
  source: Uint8ClampedArray,
  width: number,
  height: number,
  clipLimit = 1.45,
  tiles = 12
): Uint8ClampedArray {
  const tilesX = Math.min(tiles, width)
  const tilesY = Math.min(tiles, height)
  const tileWidth = width / tilesX
  const tileHeight = height / tilesY
  const maps: Uint8ClampedArray[] = []
  for (let ty = 0; ty < tilesY; ty += 1) {
    for (let tx = 0; tx < tilesX; tx += 1) {
      const x0 = Math.floor(tx * tileWidth)
      const x1 = Math.floor((tx + 1) * tileWidth)
      const y0 = Math.floor(ty * tileHeight)
      const y1 = Math.floor((ty + 1) * tileHeight)
      const histogram = new Uint32Array(256)
      for (let y = y0; y < y1; y += 1) {
        for (let x = x0; x < x1; x += 1) {
          const value = source[y * width + x]!
          histogram[value] = histogram[value]! + 1
        }
      }
      const area = Math.max(1, (x1 - x0) * (y1 - y0))
      const limit = Math.max(1, Math.floor((clipLimit * area) / 256))
      let excess = 0
      for (let level = 0; level < 256; level += 1) {
        if (histogram[level]! > limit) {
          excess += histogram[level]! - limit
          histogram[level] = limit
        }
      }
      // Redistribute the clipped excess as OpenCV does: evenly, then the residual spread
      // in steps over the whole range.
      const bonus = Math.floor(excess / 256)
      const residual = excess - bonus * 256
      for (let level = 0; level < 256; level += 1) histogram[level] = histogram[level]! + bonus
      if (residual > 0) {
        const step = Math.max(1, Math.floor(256 / residual))
        for (let level = 0, left = residual; level < 256 && left > 0; level += step, left -= 1) {
          histogram[level] = histogram[level]! + 1
        }
      }
      const map = new Uint8ClampedArray(256)
      let cumulative = 0
      for (let level = 0; level < 256; level += 1) {
        cumulative += histogram[level]!
        map[level] = clampByte((cumulative * 255) / area)
      }
      maps.push(map)
    }
  }
  const output = new Uint8ClampedArray(source.length)
  for (let y = 0; y < height; y += 1) {
    const gy = y / tileHeight - 0.5
    const ty0 = Math.max(0, Math.min(tilesY - 1, Math.floor(gy)))
    const ty1 = Math.min(tilesY - 1, ty0 + 1)
    const wy = Math.max(0, Math.min(1, gy - ty0))
    for (let x = 0; x < width; x += 1) {
      const gx = x / tileWidth - 0.5
      const tx0 = Math.max(0, Math.min(tilesX - 1, Math.floor(gx)))
      const tx1 = Math.min(tilesX - 1, tx0 + 1)
      const wx = Math.max(0, Math.min(1, gx - tx0))
      const value = source[y * width + x]!
      const top =
        maps[ty0 * tilesX + tx0]![value]! * (1 - wx) + maps[ty0 * tilesX + tx1]![value]! * wx
      const bottom =
        maps[ty1 * tilesX + tx0]![value]! * (1 - wx) + maps[ty1 * tilesX + tx1]![value]! * wx
      output[y * width + x] = clampByte(top * (1 - wy) + bottom * wy)
    }
  }
  return output
}

/** Otsu's threshold of an 8-bit image. */
export function otsuThreshold(values: Uint8ClampedArray): number {
  const histogram = new Float64Array(256)
  for (const value of values) histogram[value] = histogram[value]! + 1
  const total = values.length
  let sumAll = 0
  for (let level = 0; level < 256; level += 1) sumAll += level * histogram[level]!
  let sumBackground = 0
  let weightBackground = 0
  let best = 0
  let threshold = 0
  for (let level = 0; level < 256; level += 1) {
    weightBackground += histogram[level]!
    if (weightBackground === 0) continue
    const weightForeground = total - weightBackground
    if (weightForeground === 0) break
    sumBackground += level * histogram[level]!
    const meanBackground = sumBackground / weightBackground
    const meanForeground = (sumAll - sumBackground) / weightForeground
    const between = weightBackground * weightForeground * (meanBackground - meanForeground) ** 2
    if (between > best) {
      best = between
      threshold = level
    }
  }
  return threshold
}

/** `_levels`: black point from the darkest 0.5 %, white point from Otsu plus a margin. */
export function scanLevelPoints(values: Uint8ClampedArray): { black: number; white: number } {
  const histogram = new Uint32Array(256)
  for (const value of values) histogram[value] = histogram[value]! + 1
  let count = 0
  let darkest = 255
  for (let level = 0; level < 256; level += 1) {
    count += histogram[level]!
    if (count >= values.length * 0.005) {
      darkest = level
      break
    }
  }
  const black = Math.min(45, Math.max(18, darkest))
  const white = Math.max(black + 80, Math.min(205, Math.max(170, otsuThreshold(values) + 24)))
  return { black, white }
}

/** `_enhance`: the enhanced grey page for the given strengths. */
export function enhanceScanGray(gray: ScanGray, enhancement: ScanEnhancement): Uint8ClampedArray {
  const { width, height, values } = gray
  const highPassStrength = Math.min(2, Math.max(0, enhancement.highPass))
  const levelsStrength = Math.min(2, Math.max(0, enhancement.levels))
  const sigma = Math.max(9, Math.min(width, height) / 55)
  const background = approximateGaussianBlur(Float32Array.from(values), width, height, sigma)
  const normalized = new Uint8ClampedArray(values.length)
  for (let i = 0; i < values.length; i += 1) {
    const highPass = background[i]! > 0 ? Math.min(255, (values[i]! * 238) / background[i]!) : 0
    normalized[i] = clampByte(values[i]! * (1 - highPassStrength) + highPass * highPassStrength)
  }
  const enhanced = clahe(normalized, width, height)
  const { black, white } = scanLevelPoints(enhanced)
  const output = new Uint8ClampedArray(values.length)
  for (let i = 0; i < values.length; i += 1) {
    const stretched = Math.min(255, Math.max(0, ((enhanced[i]! - black) * 255) / (white - black)))
    output[i] = clampByte(enhanced[i]! * (1 - levelsStrength) + stretched * levelsStrength)
  }
  return output
}

/** Grey values of RGBA pixels; transparent pixels count as white paper. */
export function rgbaToScanGray(rgba: Uint8ClampedArray, width: number, height: number): ScanGray {
  const values = new Uint8ClampedArray(width * height)
  for (let pixel = 0, offset = 0; pixel < values.length; pixel += 1, offset += 4) {
    const alpha = rgba[offset + 3]! / 255
    const luminance = 0.299 * rgba[offset]! + 0.587 * rgba[offset + 1]! + 0.114 * rgba[offset + 2]!
    values[pixel] = clampByte(luminance * alpha + 255 * (1 - alpha))
  }
  return { width, height, values }
}

/** Reads an image or canvas as grey values, scaled to at most {@link SCAN_TONE_MAX_DIMENSION}. */
export function readScanGray(
  source: CanvasImageSource,
  naturalWidth: number,
  naturalHeight: number
): ScanGray | null {
  if (!naturalWidth || !naturalHeight) return null
  const scale = Math.min(1, SCAN_TONE_MAX_DIMENSION / Math.max(naturalWidth, naturalHeight))
  const width = Math.max(1, Math.round(naturalWidth * scale))
  const height = Math.max(1, Math.round(naturalHeight * scale))
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const context = canvas.getContext('2d', { willReadFrequently: true })
  if (!context) return null
  context.drawImage(source, 0, 0, width, height)
  return rgbaToScanGray(context.getImageData(0, 0, width, height).data, width, height)
}

/** A canvas with the enhanced page, ready to draw. */
export function renderScanTone(gray: ScanGray, options: ScanToneOptions): HTMLCanvasElement | null {
  // Zero strengths mean the page is drawn as stored (for pages the service already enhanced).
  const enhanced =
    options.levels === 0 && options.highPass === 0 ? gray.values : enhanceScanGray(gray, options)
  const canvas = document.createElement('canvas')
  canvas.width = gray.width
  canvas.height = gray.height
  const context = canvas.getContext('2d')
  if (!context) return null
  const output = context.createImageData(gray.width, gray.height)
  const data = output.data
  const [inkR, inkG, inkB] = options.inkColor
  for (let pixel = 0, offset = 0; pixel < enhanced.length; pixel += 1, offset += 4) {
    const level = enhanced[pixel]!
    if (options.transparentPaper) {
      data[offset] = inkR
      data[offset + 1] = inkG
      data[offset + 2] = inkB
      data[offset + 3] = 255 - level
    } else {
      data[offset] = level
      data[offset + 1] = level
      data[offset + 2] = level
      data[offset + 3] = 255
    }
  }
  context.putImageData(output, 0, 0)
  return canvas
}
