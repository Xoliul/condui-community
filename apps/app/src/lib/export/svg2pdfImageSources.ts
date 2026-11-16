/**
 * svg2pdf recognises inline images with a backtracking regex over the whole data URL.
 * Safari's regex engine gives up on that pattern beyond roughly 0.25-0.5 MB and reports
 * "no match", after which svg2pdf either drops the image or fails the page with an
 * XMLHttpRequest error. Chrome copes until about 8 MB.
 *
 * Large raster images are therefore handed to svg2pdf as same-origin blob URLs: svg2pdf
 * loads them with XMLHttpRequest and takes the format from the URL extension in `#.png`.
 * Smaller images stay inline and avoid that extra request.
 */

const RASTER_DATA_URL_RE = /^\s*data:image\/(png|jpe?g|gif|webp)[;,]/i
const XLINK_NS = 'http://www.w3.org/1999/xlink'
// Safari's svg2pdf data-URL matcher fails on larger strings. Small inline images
// avoid an unnecessary XHR (and its CSP/browser-specific failure modes).
const MAX_INLINE_RASTER_DATA_URL_LENGTH = 128 * 1024

function imageHref(imageEl: Element): string | null {
  return imageEl.getAttribute('href') ?? imageEl.getAttributeNS(XLINK_NS, 'href')
}

function dataUrlToBlob(dataUrl: string, mimeType: string): Blob | null {
  const comma = dataUrl.indexOf(',')
  if (comma < 0) return null
  const header = dataUrl.slice(0, comma)
  const body = dataUrl.slice(comma + 1)
  try {
    if (/;base64$/i.test(header)) {
      const binary = atob(body.replace(/\s/g, ''))
      const bytes = new Uint8Array(binary.length)
      for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i)
      return new Blob([bytes], { type: mimeType })
    }
    return new Blob([decodeURIComponent(body)], { type: mimeType })
  } catch {
    return null
  }
}

/**
 * Replaces raster data-URL images inside `root` with blob URLs for svg2pdf.
 * Returns a cleanup function that releases the blob URLs; call it after svg2pdf.
 */
export function swapSvg2PdfImagesToBlobUrls(root: Element): () => void {
  if (typeof URL === 'undefined' || typeof URL.createObjectURL !== 'function') return () => {}

  const created: string[] = []
  for (const imageEl of Array.from(root.querySelectorAll('image'))) {
    const href = imageHref(imageEl)
    const match = href ? RASTER_DATA_URL_RE.exec(href) : null
    if (!href || !match) continue
    const sourceFormat = match[1]!.toLowerCase()
    if (href.length <= MAX_INLINE_RASTER_DATA_URL_LENGTH && sourceFormat !== 'jpg') continue
    const extension = sourceFormat.replace('jpg', 'jpeg')
    const blob = dataUrlToBlob(href, `image/${extension}`)
    if (!blob) continue

    const blobUrl = URL.createObjectURL(blob)
    created.push(blobUrl)
    imageEl.removeAttributeNS(XLINK_NS, 'href')
    imageEl.removeAttribute('xlink:href')
    imageEl.setAttribute('href', `${blobUrl}#.${extension}`)
  }

  return () => {
    for (const url of created) URL.revokeObjectURL(url)
  }
}

/** Runs an svg2pdf call on `element` with its raster images passed as blob URLs. */
export async function withSvg2PdfImageSources<T>(
  element: Element,
  render: () => Promise<T>
): Promise<T> {
  const releaseImages = swapSvg2PdfImagesToBlobUrls(element)
  try {
    return await render()
  } finally {
    releaseImages()
  }
}
