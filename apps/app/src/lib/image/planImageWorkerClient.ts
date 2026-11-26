/** Max pixels processed off main thread; larger images fall back to the banded main-thread path. */
const MAX_WORKER_PIXELS = 32_000_000

let workerRef: Worker | null = null
let nextId = 1

export function planImageWorkerSupported(): boolean {
  return (
    typeof Worker !== 'undefined' &&
    typeof createImageBitmap === 'function' &&
    typeof OffscreenCanvas !== 'undefined'
  )
}

function getWorker(): Worker | null {
  if (!planImageWorkerSupported()) return null
  if (!workerRef) {
    try {
      workerRef = new Worker(new URL('../../workers/planImagePixels.worker.ts', import.meta.url), {
        type: 'module',
      })
    } catch {
      workerRef = null
    }
  }
  return workerRef
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () =>
      typeof reader.result === 'string'
        ? resolve(reader.result)
        : reject(new Error('Failed to read worker image'))
    reader.onerror = () => reject(new Error('Failed to read worker image'))
    reader.readAsDataURL(blob)
  })
}

function waitForWorkerPng(worker: Worker, id: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const onMessage = (ev: MessageEvent) => {
      const d = ev.data as Record<string, unknown>
      if (d?.id !== id) return
      worker.removeEventListener('message', onMessage)
      if (d.type === 'error') {
        reject(new Error(typeof d.message === 'string' ? d.message : 'worker error'))
        return
      }
      if (d.type !== 'png' || !(d.blob instanceof Blob)) {
        reject(new Error('bad worker response'))
        return
      }
      blobToDataUrl(d.blob).then(resolve, reject)
    }
    worker.addEventListener('message', onMessage)
  })
}

async function runInWorker(
  image: HTMLImageElement,
  message: { type: 'removeWhite'; threshold: number; tolerance: number } | { type: 'invert' },
): Promise<string> {
  const worker = getWorker()
  if (!worker) {
    return Promise.reject(new Error('no worker'))
  }
  const w = image.naturalWidth || image.width
  const h = image.naturalHeight || image.height
  if (w * h > MAX_WORKER_PIXELS) {
    return Promise.reject(new Error('image too large for worker'))
  }
  const bitmap = await createImageBitmap(image)
  const id = nextId++
  const resultPromise = waitForWorkerPng(worker, id)
  worker.postMessage({ ...message, id, bitmap }, [bitmap])
  return resultPromise
}

export function removeWhiteBackgroundInWorker(
  image: HTMLImageElement,
  threshold: number = 240,
  tolerance: number = 20,
): Promise<string> {
  return runInWorker(image, { type: 'removeWhite', threshold, tolerance })
}

export function invertImageColorsInWorker(image: HTMLImageElement): Promise<string> {
  return runInWorker(image, { type: 'invert' })
}
