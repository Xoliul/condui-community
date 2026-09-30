import { getPdfJs } from '@/lib/plan/pdfImport'

/** How hard to reduce a document. `auto` is the silent upload optimization for photos. */
export type DocumentCompressionLevel = 'auto' | 'balanced' | 'small'

interface ImagePreset {
  /** Longest side in pixels after scaling. */
  maxDimension: number
  quality: number
}

interface PdfPreset {
  /** Resolution the pages are re-rendered at; 72 is one pixel per PDF point. */
  dpi: number
  quality: number
}

export const IMAGE_COMPRESSION_PRESETS: Record<DocumentCompressionLevel, ImagePreset> = {
  auto: { maxDimension: 3000, quality: 0.85 },
  balanced: { maxDimension: 2400, quality: 0.8 },
  small: { maxDimension: 1600, quality: 0.7 },
}

/** Re-rendering pages is lossy (text is no longer selectable), so PDFs have no `auto` level. */
export const PDF_COMPRESSION_PRESETS: Record<Exclude<DocumentCompressionLevel, 'auto'>, PdfPreset> = {
  balanced: { dpi: 150, quality: 0.75 },
  small: { dpi: 100, quality: 0.6 },
}

/** Photos above this size or dimension are optimized automatically on upload. */
export const AUTO_OPTIMIZE_IMAGE_MIN_BYTES = 1_500_000

const RASTER_IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp'])

/** SVG is already compact text and scales losslessly; only raster images are re-encoded. */
export function isCompressibleImageType(mimeType: string): boolean {
  return RASTER_IMAGE_TYPES.has(mimeType.toLowerCase())
}

export function shouldAutoOptimizeImage(
  image: { mimeType: string; sizeBytes: number; width: number; height: number }
): boolean {
  if (!isCompressibleImageType(image.mimeType)) return false
  return (
    image.sizeBytes > AUTO_OPTIMIZE_IMAGE_MIN_BYTES ||
    Math.max(image.width, image.height) > IMAGE_COMPRESSION_PRESETS.auto.maxDimension
  )
}

/** Scale that fits the longest side within `maxDimension`, never enlarging. */
export function fitScale(width: number, height: number, maxDimension: number): number {
  const longest = Math.max(width, height)
  return longest > maxDimension ? maxDimension / longest : 1
}

export interface CompressedFile {
  blob: Blob
  mimeType: string
}

type Canvas2D = {
  canvas: HTMLCanvasElement | OffscreenCanvas
  context: OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D
}

function createCanvas(width: number, height: number): Canvas2D {
  if (typeof OffscreenCanvas !== 'undefined') {
    const canvas = new OffscreenCanvas(width, height)
    const context = canvas.getContext('2d')
    if (context) return { canvas, context }
  }
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const context = canvas.getContext('2d')
  if (!context) throw new Error('Canvas 2D is not available')
  return { canvas, context }
}

async function canvasToBlob(
  canvas: HTMLCanvasElement | OffscreenCanvas,
  type: string,
  quality: number
): Promise<Blob> {
  if ('convertToBlob' in canvas) return canvas.convertToBlob({ type, quality })
  return new Promise((resolve, reject) =>
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('Could not encode image'))),
      type,
      quality
    )
  )
}

/**
 * Re-encodes a raster image, scaled to the preset. WebP keeps transparency; where the browser
 * cannot write WebP it falls back to JPEG on a white background.
 */
export async function compressImage(
  file: Blob,
  level: DocumentCompressionLevel
): Promise<CompressedFile> {
  const preset = IMAGE_COMPRESSION_PRESETS[level]
  const bitmap = await createImageBitmap(file)
  try {
    const scale = fitScale(bitmap.width, bitmap.height, preset.maxDimension)
    const width = Math.max(1, Math.round(bitmap.width * scale))
    const height = Math.max(1, Math.round(bitmap.height * scale))
    const { canvas, context } = createCanvas(width, height)
    context.drawImage(bitmap, 0, 0, width, height)
    const webp = await canvasToBlob(canvas, 'image/webp', preset.quality)
    if (webp.type === 'image/webp') return { blob: webp, mimeType: 'image/webp' }

    const flattened = createCanvas(width, height)
    flattened.context.fillStyle = '#ffffff'
    flattened.context.fillRect(0, 0, width, height)
    flattened.context.drawImage(bitmap, 0, 0, width, height)
    const jpeg = await canvasToBlob(flattened.canvas, 'image/jpeg', preset.quality)
    return { blob: jpeg, mimeType: 'image/jpeg' }
  } finally {
    bitmap.close()
  }
}

/** Reads an image's pixel size without decoding it onto a canvas. */
export async function readImageSize(file: Blob): Promise<{ width: number; height: number }> {
  const bitmap = await createImageBitmap(file)
  const size = { width: bitmap.width, height: bitmap.height }
  bitmap.close()
  return size
}

/**
 * Rebuilds a PDF from its pages rendered as JPEG images at the preset resolution. Pages keep
 * their size and order; text becomes part of the image, so this is only ever an explicit choice.
 */
export async function compressPdf(
  bytes: Uint8Array,
  level: Exclude<DocumentCompressionLevel, 'auto'>,
  onProgress?: (done: number, total: number) => void
): Promise<Uint8Array> {
  const preset = PDF_COMPRESSION_PRESETS[level]
  const [pdfjs, { PDFDocument }] = await Promise.all([getPdfJs(), import('pdf-lib')])
  const source = await pdfjs.getDocument({ data: bytes.slice().buffer }).promise
  try {
    const target = await PDFDocument.create()
    for (let pageNumber = 1; pageNumber <= source.numPages; pageNumber++) {
      const page = await source.getPage(pageNumber)
      const pointSize = page.getViewport({ scale: 1 })
      const viewport = page.getViewport({ scale: preset.dpi / 72 })
      const width = Math.max(1, Math.round(viewport.width))
      const height = Math.max(1, Math.round(viewport.height))
      const { canvas, context } = createCanvas(width, height)
      context.fillStyle = '#ffffff'
      context.fillRect(0, 0, width, height)
      // Print intent renders without requestAnimationFrame, so a background tab keeps going.
      await page.render({
        canvasContext: context as CanvasRenderingContext2D,
        viewport,
        background: 'white',
        intent: 'print',
      } as Parameters<typeof page.render>[0]).promise
      const jpeg = await canvasToBlob(canvas, 'image/jpeg', preset.quality)
      const image = await target.embedJpg(new Uint8Array(await jpeg.arrayBuffer()))
      const output = target.addPage([pointSize.width, pointSize.height])
      output.drawImage(image, { x: 0, y: 0, width: pointSize.width, height: pointSize.height })
      onProgress?.(pageNumber, source.numPages)
    }
    return target.save({ useObjectStreams: true })
  } finally {
    await source.destroy()
  }
}
