/**
 * Decoded installer logos for the drawing info block. The logo column is only
 * reserved once the image decodes, so a missing or broken logo never leaves an
 * empty box. Layout, canvas and export share this cache to agree on the result.
 */

const MAX_CACHED_LOGOS = 4

const pending = new Map<string, Promise<HTMLImageElement | null>>()
const decoded = new Map<string, HTMLImageElement | null>()

function remember(url: string, image: HTMLImageElement | null): void {
  decoded.delete(url)
  decoded.set(url, image)
  while (decoded.size > MAX_CACHED_LOGOS) {
    const oldest = decoded.keys().next().value
    if (oldest === undefined) break
    decoded.delete(oldest)
  }
}

/** Decoded image, `null` when it failed to decode, `undefined` while unknown. */
export function getDecodedInfoBlockLogo(url: string | null | undefined): HTMLImageElement | null | undefined {
  if (!url) return null
  return decoded.get(url)
}

export function loadInfoBlockLogo(url: string | null | undefined): Promise<HTMLImageElement | null> {
  if (!url) return Promise.resolve(null)
  if (decoded.has(url)) return Promise.resolve(decoded.get(url) ?? null)
  const inFlight = pending.get(url)
  if (inFlight) return inFlight

  const promise = new Promise<HTMLImageElement | null>((resolve) => {
    const image = new window.Image()
    image.onload = () => resolve(image.naturalWidth > 0 && image.naturalHeight > 0 ? image : null)
    image.onerror = () => resolve(null)
    image.src = url
  }).then((image) => {
    pending.delete(url)
    remember(url, image)
    return image
  })
  pending.set(url, promise)
  return promise
}

const EXPORT_SVG_LOGO_MAX_PX = 1000

/**
 * Logo data URL for the PDF info block: null when it does not decode, and SVG
 * logos (older uploads) rasterized to PNG so the PDF renderer only sees raster.
 */
export async function resolveInfoBlockLogoForExport(url: string): Promise<string | null> {
  const image = await loadInfoBlockLogo(url)
  if (!image) return null
  if (!/^data:image\/svg\+xml[;,]/i.test(url)) return url
  const scale = EXPORT_SVG_LOGO_MAX_PX / Math.max(image.naturalWidth, image.naturalHeight)
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(image.naturalWidth * scale))
  canvas.height = Math.max(1, Math.round(image.naturalHeight * scale))
  const ctx = canvas.getContext('2d')
  if (!ctx) return url
  ctx.drawImage(image, 0, 0, canvas.width, canvas.height)
  try {
    return canvas.toDataURL('image/png')
  } catch {
    return url
  }
}
