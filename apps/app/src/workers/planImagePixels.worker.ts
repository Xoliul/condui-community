/// <reference lib="webworker" />

import { mapCanvasPixelsInBands } from '../utils/canvasPixelOps'
import { invertForDarkModeInPlace, removeWhitePixelsInPlace } from '../lib/image/planImagePixelOps'

type WorkerInMessage =
  | {
      type: 'removeWhite'
      id: number
      bitmap: ImageBitmap
      threshold: number
      tolerance: number
    }
  | { type: 'invert'; id: number; bitmap: ImageBitmap }

type WorkerOutMessage =
  | { type: 'png'; id: number; blob: Blob }
  | { type: 'error'; id: number; message: string }

/**
 * Edits the bitmap band by band on one OffscreenCanvas and encodes the PNG here, so neither a
 * full-frame RGBA buffer nor a second main-thread canvas is ever allocated.
 */
async function editBitmapToPng(
  bitmap: ImageBitmap,
  edit: (data: Uint8ClampedArray) => void,
): Promise<Blob> {
  const width = bitmap.width
  const height = bitmap.height
  const canvas = new OffscreenCanvas(width, height)
  try {
    const ctx = canvas.getContext('2d', { willReadFrequently: true })
    if (!ctx) {
      throw new Error('planImagePixels.worker: no 2d context')
    }
    ctx.drawImage(bitmap, 0, 0)
    bitmap.close()
    mapCanvasPixelsInBands(ctx, width, height, edit)
    if (typeof canvas.convertToBlob !== 'function') {
      throw new Error('planImagePixels.worker: convertToBlob unavailable')
    }
    return await canvas.convertToBlob({ type: 'image/png' })
  } finally {
    canvas.width = 0
    canvas.height = 0
  }
}

function post(message: WorkerOutMessage): void {
  ;(self as unknown as DedicatedWorkerGlobalScope).postMessage(message)
}

self.onmessage = (e: MessageEvent<WorkerInMessage>) => {
  const msg = e.data
  const id = msg && typeof msg === 'object' && 'id' in msg ? msg.id : -1
  const fail = (err: unknown) =>
    post({ type: 'error', id, message: err instanceof Error ? err.message : String(err) })
  try {
    if (msg.type === 'removeWhite') {
      void editBitmapToPng(msg.bitmap, (data) =>
        removeWhitePixelsInPlace(data, msg.threshold, msg.tolerance),
      ).then((blob) => post({ type: 'png', id, blob }), fail)
      return
    }
    if (msg.type === 'invert') {
      void editBitmapToPng(msg.bitmap, (data) => invertForDarkModeInPlace(data)).then(
        (blob) => post({ type: 'png', id, blob }),
        fail,
      )
    }
  } catch (err) {
    fail(err)
  }
}

export {}
