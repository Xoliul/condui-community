/**
 * Pure RGBA pixel routines shared by main-thread canvas code and the plan image worker.
 */

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

/** Same semantics as detectWhiteBackground() in planImageProcessing (edge + center samples). */
export function detectWhiteFromRgba(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  threshold: number,
): boolean {
  const samplePoints = buildWhiteDetectSamplePoints(width, height)
  let whiteCount = 0
  let totalSamples = 0

  for (const point of samplePoints) {
    const index = (point.y * width + point.x) * 4
    const r = data[index]
    const g = data[index + 1]
    const b = data[index + 2]
    const a = data[index + 3]
    if (a == null || a < 128) continue

    totalSamples++
    const brightness = ((r ?? 0) + (g ?? 0) + (b ?? 0)) / 3
    if (brightness >= threshold) {
      whiteCount++
    }
  }

  return totalSamples > 0 && whiteCount / totalSamples > 0.7
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
  data: Uint8ClampedArray,
  pixelIndex: number,
  threshold: number,
  tolerance: number,
): boolean {
  const alpha = data[pixelIndex + 3]
  if (alpha == null || alpha < 128) return false
  const brightness =
    ((data[pixelIndex] ?? 0) + (data[pixelIndex + 1] ?? 0) + (data[pixelIndex + 2] ?? 0)) / 3
  return brightness >= threshold - tolerance
}

/** Detects a painted white page background, rather than a transparent PDF canvas. */
export function detectWhitePageBackgroundFromRgba(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  threshold: number = 240,
  tolerance: number = 20,
): boolean {
  if (width < 2 || height < 2 || data.length < width * height * 4) return false

  const samplesPerSide = Math.min(32, Math.max(8, Math.floor(Math.min(width, height) / 16)))
  const sideIsWhite = (side: 'top' | 'right' | 'bottom' | 'left'): boolean => {
    let whiteSamples = 0
    for (let sample = 0; sample < samplesPerSide; sample += 1) {
      const ratio = (sample + 0.5) / samplesPerSide
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
      if (isOpaqueNearWhite(data, (y * width + x) * 4, threshold, tolerance)) whiteSamples += 1
    }
    return whiteSamples / samplesPerSide >= 0.8
  }

  return sideIsWhite('top') && sideIsWhite('right') && sideIsWhite('bottom') && sideIsWhite('left')
}

/**
 * Removes only near-white pixels connected to the canvas boundary. This avoids
 * deleting isolated white plan details when a PDF contains a white page rect.
 */
export function removeEdgeConnectedWhitePixelsInPlace(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  threshold: number,
  tolerance: number,
): void {
  if (!detectWhitePageBackgroundFromRgba(data, width, height, threshold, tolerance)) return

  type Span = { left: number; right: number; y: number }
  const pending: Span[] = []

  const consumeSpan = (y: number, seedX: number): void => {
    let left = seedX
    let right = seedX
    while (left > 0 && isOpaqueNearWhite(data, (y * width + left - 1) * 4, threshold, tolerance)) {
      left -= 1
    }
    while (
      right < width - 1 &&
      isOpaqueNearWhite(data, (y * width + right + 1) * 4, threshold, tolerance)
    ) {
      right += 1
    }
    for (let x = left; x <= right; x += 1) data[(y * width + x) * 4 + 3] = 0
    pending.push({ left, right, y })
  }

  const visitBoundary = (x: number, y: number): void => {
    if (isOpaqueNearWhite(data, (y * width + x) * 4, threshold, tolerance)) consumeSpan(y, x)
  }

  for (let x = 0; x < width; x += 1) {
    visitBoundary(x, 0)
    visitBoundary(x, height - 1)
  }
  for (let y = 1; y < height - 1; y += 1) {
    visitBoundary(0, y)
    visitBoundary(width - 1, y)
  }

  while (pending.length > 0) {
    const span = pending.pop()!
    for (const y of [span.y - 1, span.y + 1]) {
      if (y < 0 || y >= height) continue
      let x = span.left
      while (x <= span.right) {
        if (!isOpaqueNearWhite(data, (y * width + x) * 4, threshold, tolerance)) {
          x += 1
          continue
        }
        const seedX = x
        while (
          x <= span.right &&
          isOpaqueNearWhite(data, (y * width + x) * 4, threshold, tolerance)
        ) {
          x += 1
        }
        consumeSpan(y, seedX)
      }
    }
  }
}

export function invertRgbInPlace(data: Uint8ClampedArray): void {
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] === 0) continue
    data[i] = 255 - data[i]!
    data[i + 1] = 255 - data[i + 1]!
    data[i + 2] = 255 - data[i + 2]!
  }
}
