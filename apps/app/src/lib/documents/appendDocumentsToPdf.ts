import type { PDFDocument as PdfLibDocument } from 'pdf-lib'
import { getExportedDocumentPages, type ProjectDocument } from './projectDocuments'
import type { RenderLimitedDocumentPages } from './limitedDocumentPages'

/** A4 in PDF points, and the export's 15 mm margin. */
const MM_TO_PT = 72 / 25.4
const A4_SHORT_PT = 210 * MM_TO_PT
const A4_LONG_PT = 297 * MM_TO_PT
const MARGIN_PT = 15 * MM_TO_PT

export interface AppendedDocumentsResult {
  bytes: Uint8Array<ArrayBuffer>
  /** Pages added to the PDF. */
  addedPages: number
  /** Documents that could not be added (unreadable, encrypted, or unsupported content). */
  failed: Array<{ id: string; name: string; reason: string }>
}

/** Turns an image pdf-lib cannot embed (WebP, SVG) into PNG bytes. Browser only. */
export type ImageToPng = (bytes: Uint8Array, mimeType: string) => Promise<Uint8Array>

function dataUrlToBytes(dataUrl: string): Uint8Array | null {
  const comma = dataUrl.indexOf(',')
  if (!dataUrl.startsWith('data:') || comma < 0) return null
  const header = dataUrl.slice(0, comma)
  const payload = dataUrl.slice(comma + 1)
  if (/;base64$/i.test(header)) {
    const binary = atob(payload)
    const bytes = new Uint8Array(binary.length)
    for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index)
    return bytes
  }
  return new TextEncoder().encode(decodeURIComponent(payload))
}

async function browserImageToPng(bytes: Uint8Array, mimeType: string): Promise<Uint8Array> {
  const url = URL.createObjectURL(new Blob([new Uint8Array(bytes)], { type: mimeType }))
  try {
    const image = new Image()
    image.src = url
    await image.decode()
    // SVGs without an intrinsic size report 0; give them a printable default.
    const width = image.naturalWidth || 1600
    const height = image.naturalHeight || 1200
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const context = canvas.getContext('2d')
    if (!context) throw new Error('Canvas unavailable')
    context.fillStyle = '#ffffff'
    context.fillRect(0, 0, width, height)
    context.drawImage(image, 0, 0, width, height)
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'))
    if (!blob) throw new Error('Image conversion failed')
    return new Uint8Array(await blob.arrayBuffer())
  } finally {
    URL.revokeObjectURL(url)
  }
}

async function appendPdfPages(
  target: PdfLibDocument,
  PDFDocument: typeof PdfLibDocument,
  document: ProjectDocument,
  bytes: Uint8Array
): Promise<number> {
  const source = await PDFDocument.load(bytes, { ignoreEncryption: true })
  if (source.isEncrypted) throw new Error('encrypted')
  const pages = getExportedDocumentPages(document, source.getPageCount())
  const copied = await target.copyPages(
    source,
    pages.map((page) => page - 1)
  )
  for (const page of copied) target.addPage(page)
  return copied.length
}

/** One A4 page per image, orientation following the image, fitted within the margins. */
async function appendImagePage(
  target: PdfLibDocument,
  document: ProjectDocument,
  bytes: Uint8Array,
  imageToPng: ImageToPng
): Promise<number> {
  const mimeType = document.mimeType.toLowerCase()
  const image =
    mimeType === 'image/jpeg'
      ? await target.embedJpg(bytes)
      : mimeType === 'image/png'
        ? await target.embedPng(bytes)
        : await target.embedPng(await imageToPng(bytes, mimeType))
  const landscape = image.width > image.height
  const pageWidth = landscape ? A4_LONG_PT : A4_SHORT_PT
  const pageHeight = landscape ? A4_SHORT_PT : A4_LONG_PT
  const scale = Math.min(
    (pageWidth - MARGIN_PT * 2) / image.width,
    (pageHeight - MARGIN_PT * 2) / image.height
  )
  const width = image.width * scale
  const height = image.height * scale
  const page = target.addPage([pageWidth, pageHeight])
  page.drawImage(image, {
    x: (pageWidth - width) / 2,
    y: (pageHeight - height) / 2,
    width,
    height,
  })
  return 1
}

/** Limited exports: each page as a watermarked low-resolution image, at its original size. */
async function appendLimitedPages(
  target: PdfLibDocument,
  document: ProjectDocument,
  bytes: Uint8Array,
  renderLimitedPages: RenderLimitedDocumentPages
): Promise<number> {
  const pages = await renderLimitedPages(document, bytes)
  for (const { jpeg, widthPt, heightPt } of pages) {
    const image = await target.embedJpg(jpeg)
    target
      .addPage([widthPt, heightPt])
      .drawImage(image, { x: 0, y: 0, width: widthPt, height: heightPt })
  }
  return pages.length
}

/**
 * Appends attached PDFs (their selected pages) and images (one page each) to an exported PDF, in
 * the given order. A document that cannot be read is skipped and reported; the export goes on.
 * With `renderLimitedPages` (limited exports) every page is added as a watermarked image.
 */
export async function appendDocumentsToPdf(
  pdfBytes: Uint8Array | ArrayBuffer,
  documents: readonly ProjectDocument[],
  imageToPng: ImageToPng = browserImageToPng,
  renderLimitedPages?: RenderLimitedDocumentPages
): Promise<AppendedDocumentsResult> {
  const { PDFDocument } = await import('pdf-lib')
  const target = await PDFDocument.load(pdfBytes)
  let addedPages = 0
  const failed: AppendedDocumentsResult['failed'] = []

  for (const document of documents) {
    if (document.kind !== 'pdf' && document.kind !== 'image') continue
    const bytes = dataUrlToBytes(document.url)
    if (!bytes) {
      failed.push({ id: document.id, name: document.name, reason: 'unavailable' })
      continue
    }
    try {
      addedPages += renderLimitedPages
        ? await appendLimitedPages(target, document, bytes, renderLimitedPages)
        : document.kind === 'pdf'
          ? await appendPdfPages(target, PDFDocument, document, bytes)
          : await appendImagePage(target, document, bytes, imageToPng)
    } catch (error) {
      failed.push({
        id: document.id,
        name: document.name,
        reason: error instanceof Error ? error.message : String(error),
      })
    }
  }

  const saved = await target.save()
  return { bytes: new Uint8Array(saved), addedPages, failed }
}
