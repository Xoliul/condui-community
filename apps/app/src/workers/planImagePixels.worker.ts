/// <reference lib="webworker" />

import {
  detectWhiteFromRgba,
  invertForDarkModeInPlace,
  removeWhitePixelsInPlace,
} from '../lib/image/planImagePixelOps'

type WorkerInMessage =
  | { type: 'detect'; id: number; bitmap: ImageBitmap; threshold: number }
  | {
      type: 'removeWhite'
      id: number
      bitmap: ImageBitmap
      threshold: number
      tolerance: number
    }
  | { type: 'invert'; id: number; bitmap: ImageBitmap }

type WorkerOutMessage =
  | { type: 'detect'; id: number; result: boolean }
  | { type: 'raster'; id: number; width: number; height: number; buffer: ArrayBuffer }
  | { type: 'error'; id: number; message: string }

function bitmapToRgba(bitmap: ImageBitmap): { data: Uint8ClampedArray; width: number; height: number } {
  const width = bitmap.width
  const height = bitmap.height
  const canvas = new OffscreenCanvas(width, height)
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) {
    throw new Error('planImagePixels.worker: no 2d context')
  }
  ctx.drawImage(bitmap, 0, 0)
  const imageData = ctx.getImageData(0, 0, width, height)
  return { data: new Uint8ClampedArray(imageData.data), width, height }
}

self.onmessage = (e: MessageEvent<WorkerInMessage>) => {
  const msg = e.data
  try {
    if (msg.type === 'detect') {
      const { width, height, data } = bitmapToRgba(msg.bitmap)
      msg.bitmap.close()
      const result = detectWhiteFromRgba(data, width, height, msg.threshold)
      ;(self as unknown as DedicatedWorkerGlobalScope).postMessage({ type: 'detect', id: msg.id, result } satisfies WorkerOutMessage)
      return
    }

    if (msg.type === 'removeWhite') {
      const { width, height, data } = bitmapToRgba(msg.bitmap)
      msg.bitmap.close()
      removeWhitePixelsInPlace(data, msg.threshold, msg.tolerance)
      const buffer = Uint8ClampedArray.from(data).buffer
      ;(self as unknown as DedicatedWorkerGlobalScope).postMessage(
        { type: 'raster', id: msg.id, width, height, buffer } satisfies WorkerOutMessage,
        [buffer],
      )
      return
    }

    if (msg.type === 'invert') {
      const { width, height, data } = bitmapToRgba(msg.bitmap)
      msg.bitmap.close()
      invertForDarkModeInPlace(data)
      const buffer = Uint8ClampedArray.from(data).buffer
      ;(self as unknown as DedicatedWorkerGlobalScope).postMessage(
        { type: 'raster', id: msg.id, width, height, buffer } satisfies WorkerOutMessage,
        [buffer],
      )
    }
  } catch (err) {
    const id = msg && typeof msg === 'object' && 'id' in msg ? (msg as { id: number }).id : -1
    ;(self as unknown as DedicatedWorkerGlobalScope).postMessage({
      type: 'error',
      id,
      message: err instanceof Error ? err.message : String(err),
    } satisfies WorkerOutMessage)
  }
}

export {}
