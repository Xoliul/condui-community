import type { TrikFigure, TrikPoint, TrikVectorLine, TrikVectorRect } from '@/lib/import/trik/shared'
import {
  scaledPoint,
  TRIK_PLAN_COMPOSITE_RENDER_SCALE,
  TRIK_TO_PLAN_SCALE,
} from '@/lib/import/trik/shared'

export type ImportedFigureAsset = {
  width: number
  height: number
  offset: { x: number; y: number }
  dataUrl: string
  processedDataUrl?: string
  darkModeAware?: boolean
  hasWhiteBackground?: boolean
}

export type PendingTrikSitplanNote = {
  nodeId: string
  text: string
  fontSize: number
}

export function loadDataUrlImage(dataUrl: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new window.Image()
    image.onload = () => resolve(image)
    image.onerror = () => reject(new Error('Failed to decode figure image'))
    image.src = dataUrl
  })
}

export function trikCompositeLineRenderWidth(strokeWidth: number): number {
  return Math.max(6, strokeWidth * 5)
}

export function trikCompositeRectStrokeWidth(strokeWidth: number): number {
  return Math.max(2, strokeWidth * TRIK_TO_PLAN_SCALE * 1.5)
}

export function axisBoundsFromLineStroke(
  p1: TrikPoint,
  p2: TrikPoint,
  renderWidth: number,
): { minX: number; minY: number; maxX: number; maxY: number } {
  const half = renderWidth / 2
  return {
    minX: Math.min(p1.x, p2.x) - half,
    minY: Math.min(p1.y, p2.y) - half,
    maxX: Math.max(p1.x, p2.x) + half,
    maxY: Math.max(p1.y, p2.y) + half,
  }
}

export function rotatedRectCorners(
  width: number,
  height: number,
  center: TrikPoint,
  rotationDeg: number,
): TrikPoint[] {
  const rad = (rotationDeg * Math.PI) / 180
  const cos = Math.cos(rad)
  const sin = Math.sin(rad)
  const halfW = width / 2
  const halfH = height / 2
  return [
    { x: -halfW, y: -halfH },
    { x: halfW, y: -halfH },
    { x: halfW, y: halfH },
    { x: -halfW, y: halfH },
  ].map((corner) => ({
    x: center.x + corner.x * cos - corner.y * sin,
    y: center.y + corner.x * sin + corner.y * cos,
  }))
}

export function axisBoundsFromPoints(points: TrikPoint[], padding = 0): {
  minX: number
  minY: number
  maxX: number
  maxY: number
} {
  const minX = Math.min(...points.map((point) => point.x)) - padding
  const minY = Math.min(...points.map((point) => point.y)) - padding
  const maxX = Math.max(...points.map((point) => point.x)) + padding
  const maxY = Math.max(...points.map((point) => point.y)) + padding
  return { minX, minY, maxX, maxY }
}

export async function buildFigureAsset(
  figures: TrikFigure[],
  lines: TrikVectorLine[],
  decorativeRects: TrikVectorRect[],
): Promise<ImportedFigureAsset | undefined> {
  if (figures.length === 0 && lines.length === 0 && decorativeRects.length === 0) return undefined
  const figureRects = figures.map((figure) => {
    const width = figure.width * TRIK_TO_PLAN_SCALE
    const height = figure.height * TRIK_TO_PLAN_SCALE
    const center = scaledPoint(figure.center)
    const rad = (figure.rotationDeg * Math.PI) / 180
    const corners = rotatedRectCorners(width, height, center, figure.rotationDeg)
    const minX = Math.min(...corners.map((point) => point.x))
    const minY = Math.min(...corners.map((point) => point.y))
    const maxX = Math.max(...corners.map((point) => point.x))
    const maxY = Math.max(...corners.map((point) => point.y))
    return {
      figure,
      center,
      width,
      height,
      rotationRad: rad,
      minX,
      minY,
      maxX,
      maxY,
    }
  })
  const lineBounds = lines.map((line) => {
    const p1 = scaledPoint(line.p1)
    const p2 = scaledPoint(line.p2)
    return axisBoundsFromLineStroke(p1, p2, trikCompositeLineRenderWidth(line.strokeWidth))
  })
  const decorativeRectBounds = decorativeRects.map((rect) => {
    const w = rect.width * TRIK_TO_PLAN_SCALE
    const h = rect.height * TRIK_TO_PLAN_SCALE
    const c = scaledPoint(rect.center)
    const corners = rotatedRectCorners(w, h, c, rect.rotationDeg)
    const strokePad = trikCompositeRectStrokeWidth(rect.strokeWidth) / 2
    return axisBoundsFromPoints(corners, strokePad)
  })
  const allMinX = [
    ...figureRects.map((rect) => rect.minX),
    ...lineBounds.map((bounds) => bounds.minX),
    ...decorativeRectBounds.map((bounds) => bounds.minX),
  ]
  const allMinY = [
    ...figureRects.map((rect) => rect.minY),
    ...lineBounds.map((bounds) => bounds.minY),
    ...decorativeRectBounds.map((bounds) => bounds.minY),
  ]
  const allMaxX = [
    ...figureRects.map((rect) => rect.maxX),
    ...lineBounds.map((bounds) => bounds.maxX),
    ...decorativeRectBounds.map((bounds) => bounds.maxX),
  ]
  const allMaxY = [
    ...figureRects.map((rect) => rect.maxY),
    ...lineBounds.map((bounds) => bounds.maxY),
    ...decorativeRectBounds.map((bounds) => bounds.maxY),
  ]
  const minX = Math.min(...allMinX)
  const minY = Math.min(...allMinY)
  const maxX = Math.max(...allMaxX)
  const maxY = Math.max(...allMaxY)
  const width = Math.max(1, maxX - minX)
  const height = Math.max(1, maxY - minY)

  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.ceil(width * TRIK_PLAN_COMPOSITE_RENDER_SCALE))
  canvas.height = Math.max(1, Math.ceil(height * TRIK_PLAN_COMPOSITE_RENDER_SCALE))
  const context = canvas.getContext('2d')
  if (!context) return undefined
  context.scale(TRIK_PLAN_COMPOSITE_RENDER_SCALE, TRIK_PLAN_COMPOSITE_RENDER_SCALE)
  for (const rect of figureRects) {
    const dataUrl = `data:image/jpeg;base64,${rect.figure.imageAsBase64}`
    let image: HTMLImageElement | null = null
    try {
      image = await loadDataUrlImage(dataUrl)
    } catch {
      // Keep import robust for malformed embedded assets: preserve placement bounds even if image decode fails.
      image = null
    }
    if (!image) continue
    context.save()
    context.translate(rect.center.x - minX, rect.center.y - minY)
    context.rotate(rect.rotationRad)
    context.drawImage(image, -rect.width / 2, -rect.height / 2, rect.width, rect.height)
    context.restore()
  }
  for (const line of lines) {
    const p1 = scaledPoint(line.p1)
    const p2 = scaledPoint(line.p2)
    context.save()
    context.strokeStyle = line.color ?? '#000000'
    context.lineWidth = trikCompositeLineRenderWidth(line.strokeWidth)
    context.lineCap = 'round'
    context.lineJoin = 'round'
    context.beginPath()
    context.moveTo(p1.x - minX, p1.y - minY)
    context.lineTo(p2.x - minX, p2.y - minY)
    context.stroke()
    context.restore()
  }
  for (const rect of decorativeRects) {
    const w = rect.width * TRIK_TO_PLAN_SCALE
    const h = rect.height * TRIK_TO_PLAN_SCALE
    const c = scaledPoint(rect.center)
    const rad = (rect.rotationDeg * Math.PI) / 180
    const stroke = rect.color ?? '#000000'
    context.save()
    context.translate(c.x - minX, c.y - minY)
    context.rotate(rad)
    if ((rect.fillType ?? '').toLowerCase() !== 'geen') {
      context.fillStyle = 'rgba(0,0,0,0.08)'
      context.fillRect(-w / 2, -h / 2, w, h)
    }
    context.strokeStyle = stroke
    context.lineWidth = trikCompositeRectStrokeWidth(rect.strokeWidth)
    context.lineCap = 'round'
    context.lineJoin = 'round'
    context.strokeRect(-w / 2, -h / 2, w, h)
    context.restore()
  }
  const dataUrl = canvas.toDataURL('image/png')
  return {
    width,
    height,
    offset: { x: minX, y: minY },
    dataUrl,
    // Reuse same raster as processed source so existing dark-mode inversion pipeline can invert it.
    processedDataUrl: dataUrl,
    darkModeAware: true,
    hasWhiteBackground: true,
  }
}
