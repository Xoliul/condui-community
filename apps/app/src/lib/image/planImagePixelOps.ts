/**
 * Pure RGBA pixel routines shared by main-thread canvas code and the plan image worker.
 */

import type { PixelSampler } from '@/utils/canvasPixelOps'

function buildWhiteDetectSamplePoints(width: number, height: number): Array<{ x: number; y: number }> {
  const samplePoints: Array<{ x: number; y: number }> = []
  samplePoints.push({ x: 0, y: 0 })
  samplePoints.push({ x: width - 1, y: 0 })
  samplePoints.push({ x: 0, y: height - 1 })
  samplePoints.push({ x: width - 1, y: height - 1 })
  for (let i = 0.1; i < 1; i += 0.1) {
    samplePoints.push({ x: Math.floor(width * i), y: 0 })
    samplePoints.push({ x: Math.floor(width * i), y: height - 1 })
    samplePoints.push({ x: 0, y: Math.floor(height * i) })
    samplePoints.push({ x: width - 1, y: Math.floor(height * i) })
  }
  samplePoints.push({ x: Math.floor(width / 2), y: Math.floor(height / 2) })
  return samplePoints
}

function rgbaSampler(data: Uint8ClampedArray, width: number): PixelSampler {
  return (x, y) => {
    const index = (y * width + x) * 4
    return [data[index] ?? 0, data[index + 1] ?? 0, data[index + 2] ?? 0, data[index + 3] ?? 0]
  }
}

/** Same semantics as detectWhiteBackground() in planImageProcessing (edge + center samples). */
export function detectWhiteFromSampler(
  sample: PixelSampler,
  width: number,
  height: number,
  threshold: number,
): boolean {
  const samplePoints = buildWhiteDetectSamplePoints(width, height)
  let whiteCount = 0
  let totalSamples = 0

  for (const point of samplePoints) {
    const [r, g, b, a] = sample(point.x, point.y)
    if (a < 128) continue

    totalSamples++
    const brightness = (r + g + b) / 3
    if (brightness >= threshold) {
      whiteCount++
    }
  }

  return totalSamples > 0 && whiteCount / totalSamples > 0.7
}

export function detectWhiteFromRgba(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  threshold: number,
): boolean {
  return detectWhiteFromSampler(rgbaSampler(data, width), width, height, threshold)
}

export function removeWhitePixelsInPlace(data: Uint8ClampedArray, threshold: number, tolerance: number): void {
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i]
    const g = data[i + 1]
    const b = data[i + 2]
    const brightness = ((r ?? 0) + (g ?? 0) + (b ?? 0)) / 3
    if (brightness >= threshold - tolerance) {
      data[i + 3] = 0
    }
  }
}

function isOpaqueNearWhite(
  [r, g, b, alpha]: readonly [number, number, number, number],
  threshold: number,
  tolerance: number,
): boolean {
  if (alpha < 128) return false
  return (r + g + b) / 3 >= threshold - tolerance
}

/** Detects a painted white page background, rather than a transparent PDF canvas. */
export function detectWhitePageBackgroundFromSampler(
  sample: PixelSampler,
  width: number,
  height: number,
  threshold: number = 240,
  tolerance: number = 20,
): boolean {
  if (width < 2 || height < 2) return false

  const samplesPerSide = Math.min(32, Math.max(8, Math.floor(Math.min(width, height) / 16)))
  const sideIsWhite = (side: 'top' | 'right' | 'bottom' | 'left'): boolean => {
    let whiteSamples = 0
    for (let step = 0; step < samplesPerSide; step += 1) {
      const ratio = (step + 0.5) / samplesPerSide
      const x =
        side === 'left'
          ? 0
          : side === 'right'
            ? width - 1
            : Math.min(width - 1, Math.floor(ratio * width))
      const y =
        side === 'top'
          ? 0
          : side === 'bottom'
            ? height - 1
            : Math.min(height - 1, Math.floor(ratio * height))
      if (isOpaqueNearWhite(sample(x, y), threshold, tolerance)) whiteSamples += 1
    }
    return whiteSamples / samplesPerSide >= 0.8
  }

  return sideIsWhite('top') && sideIsWhite('right') && sideIsWhite('bottom') && sideIsWhite('left')
}

/** Detects a painted white page background, rather than a transparent PDF canvas. */
export function detectWhitePageBackgroundFromRgba(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  threshold: number = 240,
  tolerance: number = 20,
): boolean {
  if (data.length < width * height * 4) return false
  return detectWhitePageBackgroundFromSampler(rgbaSampler(data, width), width, height, threshold, tolerance)
}

/**
 * Dark-mode plan rendering: clear the white paper with the same mask as white-page removal,
 * then invert what remains at its original opacity. Linework and grey fills stay solid (they
 * hide the canvas grid); only the paper becomes transparent, whether or not a white page was
 * detected for the plan.
 */
export function invertForDarkModeInPlace(
  data: Uint8ClampedArray,
  threshold: number = 240,
  tolerance: number = 20,
): void {
  removeWhitePixelsInPlace(data, threshold, tolerance)
  invertRgbInPlace(data)
}

export function invertRgbInPlace(data: Uint8ClampedArray): void {
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] === 0) continue
    data[i] = 255 - data[i]!
    data[i + 1] = 255 - data[i + 1]!
    data[i + 2] = 255 - data[i + 2]!
  }
}
