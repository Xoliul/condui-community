/**
 * Memory-lean canvas helpers for plan rasters. A 4000x3000 plan is 48 MB as RGBA, so these
 * helpers avoid full-frame `getImageData` buffers: detection reads single pixels and
 * per-pixel edits run over horizontal bands, which gives byte-identical results.
 */
/** Reads one RGBA pixel; lets detection touch a few samples instead of a whole decoded raster. */
export type PixelSampler = (x: number, y: number) => readonly [number, number, number, number]

type Context2D = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D

/** Target RGBA bytes per band (about 4 MB), independent of the image size. */
const BAND_BYTES = 4 * 1024 * 1024

export function bandRowCount(width: number): number {
  return Math.max(1, Math.floor(BAND_BYTES / (Math.max(1, width) * 4)))
}

/** Applies an in-place RGBA edit to the whole canvas, one band of rows at a time. */
export function mapCanvasPixelsInBands(
  ctx: Context2D,
  width: number,
  height: number,
  edit: (data: Uint8ClampedArray) => void,
): void {
  const rows = bandRowCount(width)
  for (let y = 0; y < height; y += rows) {
    const bandHeight = Math.min(rows, height - y)
    const band = ctx.getImageData(0, y, width, bandHeight)
    edit(band.data)
    ctx.putImageData(band, 0, y)
  }
}

/** Frees the backing store of a scratch canvas right away instead of waiting for GC. */
export function releaseCanvas(canvas: HTMLCanvasElement | OffscreenCanvas | null | undefined): void {
  if (!canvas) return
  canvas.width = 0
  canvas.height = 0
}

/**
 * Reads single pixels of an image without allocating a full-size canvas: each sample draws
 * one source pixel (no smoothing, so it is exact) onto a 1x1 canvas.
 */
export function createImagePixelSampler(
  image: CanvasImageSource,
): { sample: PixelSampler; dispose: () => void } | null {
  const canvas = document.createElement('canvas')
  canvas.width = 1
  canvas.height = 1
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) return null
  ctx.imageSmoothingEnabled = false
  return {
    sample: (x, y) => {
      ctx.clearRect(0, 0, 1, 1)
      ctx.drawImage(image, x, y, 1, 1, 0, 0, 1, 1)
      const d = ctx.getImageData(0, 0, 1, 1).data
      return [d[0] ?? 0, d[1] ?? 0, d[2] ?? 0, d[3] ?? 0]
    },
    dispose: () => releaseCanvas(canvas),
  }
}
