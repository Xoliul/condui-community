import type Konva from 'konva'

/** Long enough for a large project's hidden export canvas to mount on a slow device. */
export const EXPORT_STAGE_WAIT_MS = 5000

function nextFrame(): Promise<void> {
  return new Promise((resolve) => {
    // Background tabs pause animation frames; the timeout keeps the wait bounded.
    const timeout = setTimeout(resolve, 50)
    requestAnimationFrame(() => {
      clearTimeout(timeout)
      resolve()
    })
  })
}

/** Polls a canvas registry lookup until its Konva stage exists or the time budget runs out. */
export async function waitForExportStage(
  getStage: () => Konva.Stage | null | undefined,
  timeoutMs = EXPORT_STAGE_WAIT_MS
): Promise<Konva.Stage | null> {
  const deadline = Date.now() + timeoutMs
  let stage = getStage() ?? null
  while (!stage && Date.now() < deadline) {
    await nextFrame()
    stage = getStage() ?? null
  }
  return stage
}
