import { APP_SERVER_API_PATHS, fetchAppServerApi } from '@/lib/appServerApi'
import { inlineSvgEmbeddedImages } from '@/utils/planImageProcessing'
import { clamp } from '@/lib/geometry'
import { logger } from '@/lib/logger'
import { createPlanScaleReference } from './planScale'
import type { CadLayerInfo } from './cadLayers'

export interface PdfImportCropBox {
  x: number
  y: number
  width: number
  height: number
}

export interface PdfImportPageCandidate {
  pageIndex: number
  pageCount: number
  /** Human-readable page name, e.g. the floor shown by a DWG layout viewport. */
  label?: string
  width: number
  height: number
  previewDataUrl: string
  vectorSvg?: string
  rasterDataUrl: string
  hasEmbeddedRasterImages?: boolean
  warnings: string[]
  scaleReference?: { p1: { x: number; y: number }; p2: { x: number; y: number }; meters: number }
  scaleMetersPerPixel?: number
  /** DWG views: layers present in this view, toggled by rewriting `vectorSvg` from `cadSourceSvg`. */
  cadLayers?: CadLayerInfo[]
  /** DWG views: normalized SVG with every layer, before hidden layers are removed. */
  cadSourceSvg?: string
}

export interface ParsePdfOptions {
  previewScale?: number
  rasterScale?: number
  maxPages?: number
}

export interface ParsedPdfResult {
  fileName: string
  pageCount: number
  pages: PdfImportPageCandidate[]
  warnings: string[]
}

export interface PdfScaleReference {
  p1: { x: number; y: number }
  p2: { x: number; y: number }
  meters: number
  coordinateSpace?: 'asset'
}

/** Convert a ruler drawn on a raster preview into plan-canvas asset coordinates. */
export function mapPdfScaleReferenceToAsset(
  reference: PdfScaleReference,
  previewSize: { width: number; height: number },
  assetSize: { width: number; height: number },
): { reference: PdfScaleReference; pxPerMeter: number } | null {
  if (
    reference.meters <= 0 ||
    previewSize.width <= 0 ||
    previewSize.height <= 0 ||
    assetSize.width <= 0 ||
    assetSize.height <= 0
  ) {
    return null
  }

  const scaleX = assetSize.width / previewSize.width
  const scaleY = assetSize.height / previewSize.height
  const p1 = { x: reference.p1.x * scaleX, y: reference.p1.y * scaleY }
  const p2 = { x: reference.p2.x * scaleX, y: reference.p2.y * scaleY }
  const pxDistance = Math.hypot(p2.x - p1.x, p2.y - p1.y)
  if (!Number.isFinite(pxDistance) || pxDistance <= 0) return null

  const mappedReference = createPlanScaleReference(p1, p2, reference.meters)
  if (!mappedReference) return null
  return {
    reference: mappedReference,
    pxPerMeter: pxDistance / reference.meters,
  }
}

export interface NormalizedPdfPageAsset {
  kind: 'pdf-vector' | 'pdf-raster'
  pageIndex: number
  pageCount: number
  width: number
  height: number
  sourceName?: string
  dataUrl?: string
  svgContent?: string
  previewDataUrl: string
  crop?: PdfImportCropBox
  warnings: string[]
}

export function mapPreviewCropToPageCrop(
  crop: PdfImportCropBox,
  previewSize: { width: number; height: number },
  pageSize: { width: number; height: number }
): PdfImportCropBox {
  const scaleX = pageSize.width / previewSize.width
  const scaleY = pageSize.height / previewSize.height
  return {
    x: crop.x * scaleX,
    y: crop.y * scaleY,
    width: crop.width * scaleX,
    height: crop.height * scaleY,
  }
}

/** Convert a crop stored in PDF page coordinates into pixels of a rendered image. */
export function mapPageCropToImageCrop(
  crop: PdfImportCropBox,
  pageSize: { width: number; height: number },
  imageSize: { width: number; height: number },
): PdfImportCropBox {
  const scaleX = imageSize.width / pageSize.width
  const scaleY = imageSize.height / pageSize.height
  return {
    x: crop.x * scaleX,
    y: crop.y * scaleY,
    width: crop.width * scaleX,
    height: crop.height * scaleY,
  }
}

const DEFAULT_PREVIEW_SCALE = 0.2
const DEFAULT_RASTER_SCALE = 2
const DEFAULT_MAX_PAGES = 20
const MAX_VECTOR_SVG_LENGTH = 12_000_000
const FORCE_FONT_FAMILY = import.meta.env?.VITE_PDF_CONVERT_FORCE_FONT_FAMILY || 'Arial, sans-serif'

// Keep PDF imports consistent between local and hosted builds. The optional
// server/vector path is local-only until it moves to a dedicated lightweight service.
const ENABLE_PDF_VECTOR_CONVERSION = false

interface PdfViewportLike {
  width: number
  height: number
}

interface PdfRenderTaskLike {
  promise: Promise<unknown>
}

interface PdfTextItemLike {
  str?: string
  transform?: unknown[]
}

interface PdfTextContentLike {
  items?: PdfTextItemLike[]
}

interface PdfPageProxyLike {
  commonObjs: unknown
  objs: unknown
  getViewport(options: { scale: number }): PdfViewportLike
  render(options: {
    canvasContext: CanvasRenderingContext2D
    viewport: PdfViewportLike
    background?: string
  }): PdfRenderTaskLike
  getOperatorList(options: {
    intent: 'display'
    renderInteractiveForms: boolean
    annotationMode: number
  }): Promise<unknown>
  getTextContent(): Promise<PdfTextContentLike>
}

interface PdfDocumentProxyLike {
  numPages: number
  getPage(pageNumber: number): Promise<PdfPageProxyLike>
  getAttachments(): Promise<Record<string, unknown> | null>
  destroy(): Promise<void> | void
}

interface PdfLoadingTaskLike {
  promise: Promise<PdfDocumentProxyLike>
}

interface PdfSvgGraphicsLike {
  getSVG(operatorList: unknown, viewport: PdfViewportLike): Promise<SVGElement>
}

interface PdfJsModuleLike {
  GlobalWorkerOptions: { workerSrc?: string }
  getDocument(options: { data: ArrayBuffer; [key: string]: unknown }): PdfLoadingTaskLike
  SVGGraphics?: new (commonObjs: unknown, objs: unknown) => PdfSvgGraphicsLike
}

let workerInitialized = false
let backendVectorStatus: 'unknown' | 'available' | 'unavailable' = 'unknown'

/**
 * Where the app serves pdf.js's WebAssembly decoders (see `createPdfjsWasmPlugin` in the Vite
 * configs). Absolute, because pdf.js loads them from its worker.
 */
function pdfjsWasmUrl(): string | undefined {
  if (typeof window === 'undefined' || !window.location) return undefined
  return new URL(`${import.meta.env.BASE_URL}pdfjs-wasm/`, window.location.href).href
}

let wrappedPdfJs: PdfJsModuleLike | null = null

/**
 * pdf.js, with every document opened with the WebAssembly decoders available. Without them a
 * page using a JBIG2/CCITT fax or JPEG 2000 image loses everything drawn after that image.
 */
export async function getPdfJs() {
  const pdfjs = (await import('pdfjs-dist/legacy/build/pdf.mjs')) as unknown as PdfJsModuleLike
  if (!workerInitialized) {
    const workerSrc = (await import('pdfjs-dist/legacy/build/pdf.worker.min.mjs?url')).default
    pdfjs.GlobalWorkerOptions.workerSrc = workerSrc
    workerInitialized = true
  }
  wrappedPdfJs ??= {
    ...pdfjs,
    getDocument: (options) => {
      const wasmUrl = pdfjsWasmUrl()
      return pdfjs.getDocument(wasmUrl ? { wasmUrl, ...options } : options)
    },
  }
  return wrappedPdfJs
}

function normalizeCropBox(crop: PdfImportCropBox, page: { width: number; height: number }): PdfImportCropBox {
  const x = clamp(crop.x, 0, page.width - 1)
  const y = clamp(crop.y, 0, page.height - 1)
  const maxWidth = Math.max(1, page.width - x)
  const maxHeight = Math.max(1, page.height - y)
  return {
    x,
    y,
    width: clamp(maxWidth, 1, crop.width),
    height: clamp(maxHeight, 1, crop.height),
  }
}

async function renderPageToDataUrl(page: PdfPageProxyLike, scale: number): Promise<string> {
  const viewport = page.getViewport({ scale })
  const canvas = document.createElement('canvas')
  canvas.width = Math.ceil(viewport.width)
  canvas.height = Math.ceil(viewport.height)
  const context = canvas.getContext('2d')
  if (!context) throw new Error('Failed to create canvas context')
  context.clearRect(0, 0, canvas.width, canvas.height)
  await page.render({ canvasContext: context, viewport, background: 'transparent' }).promise
  return canvas.toDataURL('image/png')
}

async function renderPageToSvg(
  page: PdfPageProxyLike,
  width: number,
  height: number
): Promise<{ svg?: string; warning?: string; hasEmbeddedRasterImages?: boolean }> {
  try {
    const pdfjs = await getPdfJs()
    const SVGGraphics = pdfjs.SVGGraphics
    if (!SVGGraphics) {
      return { warning: 'Vector extraction unavailable: PDF SVG renderer is not exposed by pdf.js build.' }
    }
    const opList = await page.getOperatorList({
      intent: 'display',
      renderInteractiveForms: false,
      annotationMode: 0,
    })
    const svgGfx = new SVGGraphics(page.commonObjs, page.objs)
    const svgElement = await svgGfx.getSVG(opList, page.getViewport({ scale: 1 }))
    svgElement.setAttribute('width', String(width))
    svgElement.setAttribute('height', String(height))
    if (!svgElement.getAttribute('viewBox')) {
      svgElement.setAttribute('viewBox', `0 0 ${width} ${height}`)
    }
    const normalized = normalizeSvgForImport(new XMLSerializer().serializeToString(svgElement))
    const rebuilt = await rebuildDecodedTextLayer(normalized, page)
    const inlined = await inlineSvgEmbeddedImages(rebuilt)
    const serialized = inlined.svg
    if (inlined.hadUnresolvedImages) {
      return {
        warning: 'Some embedded raster images could not be inlined in vector output.',
        svg: serialized,
      }
    }
    if (serialized.length > MAX_VECTOR_SVG_LENGTH) {
      return {
        warning: `Vector extraction skipped: SVG payload too large (${Math.round(serialized.length / 1024)} KB).`,
      }
    }
    return { svg: serialized, hasEmbeddedRasterImages: inlined.hadEmbeddedImages }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'unknown error'
    return { warning: `Vector extraction failed: ${message}` }
  }
}

function normalizeSvgForImport(svgContent: string): string {
  const parser = new DOMParser()
  const doc = parser.parseFromString(svgContent, 'image/svg+xml')
  const svg = doc.documentElement

  const annotationNodes = svg.querySelectorAll('[data-annotation-id], [annotation-id], .annotation')
  annotationNodes.forEach((node) => node.parentNode?.removeChild(node))

  const style = doc.createElement('style')
  style.textContent = `text, tspan { font-family: ${FORCE_FONT_FAMILY} !important; }`
  svg.insertBefore(style, svg.firstChild)

  const textLikeNodes = svg.querySelectorAll('text, tspan, svg\\:text, svg\\:tspan')
  textLikeNodes.forEach((node) => {
    node.removeAttribute('font-family')
    node.removeAttribute('font')
  })

  return new XMLSerializer().serializeToString(svg)
}

async function rebuildDecodedTextLayer(svgContent: string, page: PdfPageProxyLike): Promise<string> {
  const textContent = await page.getTextContent()
  const viewport = page.getViewport({ scale: 1 })
  const parser = new DOMParser()
  const svgDoc = parser.parseFromString(svgContent, 'image/svg+xml')
  const svg = svgDoc.documentElement

  const oldTexts = svg.querySelectorAll('text, tspan, svg\\:text, svg\\:tspan')
  oldTexts.forEach((node) => node.parentNode?.removeChild(node))

  const textItems = Array.isArray(textContent?.items) ? textContent.items : []
  const layer = svgDoc.createElement('g')
  layer.setAttribute('id', 'decoded-text-layer')
  layer.setAttribute('data-eendra', 'decoded-text')
  let injected = 0

  for (const item of textItems) {
    const str = typeof item?.str === 'string' ? item.str : ''
    if (!str.trim()) continue
    const tr = Array.isArray(item?.transform) ? item.transform : null
    if (!tr || tr.length < 6) continue
    const raw = tr.map((n: unknown) => Number(n))
    if (raw.length < 6 || !raw.every(Number.isFinite)) continue
    const [a, b, c, d, e] = raw
    const fRaw = raw[5]!
    const f = viewport.height - fRaw
    if (![a, b, c, d, e, f].every(Number.isFinite)) continue

    const text = svgDoc.createElement('text')
    text.setAttribute('transform', `matrix(${a} ${b} ${c} ${d} ${e} ${f})`)
    text.setAttribute('style', `font-family:${FORCE_FONT_FAMILY};font-size:1px;white-space:pre;`)
    text.textContent = str
    layer.appendChild(text)
    injected += 1
  }

  if (injected > 0) svg.appendChild(layer)
  return new XMLSerializer().serializeToString(svg)
}

async function convertPdfPageViaBackend(
  file: File,
  pageIndex: number
): Promise<{
  svg?: string
  width?: number
  height?: number
  pageCount?: number
  warning?: string
  warnings?: string[]
  errorCode?: string
  retriable?: boolean
  hasEmbeddedRasterImages?: boolean
}> {
  if (backendVectorStatus === 'unavailable') {
    return {
      warning: 'Vector conversion endpoint unavailable in this environment.',
      errorCode: 'ENDPOINT_UNAVAILABLE',
      retriable: true,
    }
  }
  try {
    const formData = new FormData()
    formData.append('file', file, file.name || 'upload.pdf')
    formData.append('pageIndex', String(pageIndex))
    const response = await fetchAppServerApi(APP_SERVER_API_PATHS.convertPdf, {
      method: 'POST',
      body: formData,
    })
    const payload = await response.json().catch(() => null)
    if (!response.ok) {
      const errorCode = payload?.error?.code ? String(payload.error.code) : undefined
      const message = payload?.error?.message ?? `HTTP ${response.status}`
      if (
        response.status === 404 ||
        errorCode === 'ENDPOINT_UNAVAILABLE' ||
        errorCode === 'PDF_EXTRACTOR_RUNTIME_MISSING'
      ) {
        backendVectorStatus = 'unavailable'
      }
      const conciseMessage =
        errorCode === 'PDF_EXTRACTOR_RUNTIME_MISSING'
          ? 'PDF vector backend runtime is unavailable on this machine.'
          : message
      return {
        warning: `Vector extraction failed: ${conciseMessage}`,
        errorCode,
        retriable: response.status >= 500 && !errorCode,
      }
    }
    if (!payload?.svgContent) {
      return {
        warning: 'Vector extraction unavailable from conversion backend.',
        errorCode: 'SVG_MISSING',
        retriable: false,
      }
    }
    backendVectorStatus = 'available'
    const svg = String(payload.svgContent)
    if (svg.length > MAX_VECTOR_SVG_LENGTH) {
      return {
        warning: `Vector extraction skipped: SVG payload too large (${Math.round(svg.length / 1024)} KB).`,
      }
    }
    return {
      svg,
      width: Number(payload.width),
      height: Number(payload.height),
      pageCount: Number(payload.pageCount),
      warnings: Array.isArray(payload.warnings)
        ? payload.warnings.map((warning: unknown) => String(warning))
        : undefined,
      warning: undefined,
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'backend unavailable'
    backendVectorStatus = 'unavailable'
    return {
      warning: `Vector conversion endpoint unavailable: ${message}`,
      errorCode: 'ENDPOINT_UNAVAILABLE',
      retriable: true,
    }
  }
}

export async function parsePdfFile(file: File, options: ParsePdfOptions = {}): Promise<ParsedPdfResult> {
  const pdfjs = await getPdfJs()
  const previewScale = options.previewScale ?? DEFAULT_PREVIEW_SCALE
  const rasterScale = options.rasterScale ?? DEFAULT_RASTER_SCALE
  const maxPages = options.maxPages ?? DEFAULT_MAX_PAGES
  const bytes = await file.arrayBuffer()
  const loadingTask = pdfjs.getDocument({ data: bytes })
  const doc = await loadingTask.promise
  const warnings: string[] = []
  const pageCount = doc.numPages
  const pageLimit = Math.min(pageCount, maxPages)
  if (pageCount > maxPages) {
    warnings.push(`Only first ${maxPages} pages are loaded.`)
  }

  const pages: PdfImportPageCandidate[] = []
  for (let i = 1; i <= pageLimit; i += 1) {
    const page = await doc.getPage(i)
    const viewport = page.getViewport({ scale: 1 })
    const width = viewport.width
    const height = viewport.height
    const previewDataUrl = await renderPageToDataUrl(page, previewScale)
    const rasterDataUrl = await renderPageToDataUrl(page, rasterScale)
    let vectorResult: Awaited<ReturnType<typeof convertPdfPageViaBackend>> = {}
    if (ENABLE_PDF_VECTOR_CONVERSION) {
      vectorResult = await convertPdfPageViaBackend(file, i - 1)
      if (vectorResult.warning) {
        logger.warn('[pdfImport] backend vector extraction warning', {
          file: file.name,
          pageIndex: i - 1,
          warning: vectorResult.warning,
          errorCode: vectorResult.errorCode,
          retriable: vectorResult.retriable,
        })
      }
      const shouldAttemptLocalFallback = !vectorResult.svg
      if (shouldAttemptLocalFallback) {
        // Always try local svg extraction when backend did not return vector output.
        // This keeps vector import resilient when optional backend/native deps are missing.
        const backendWarning = vectorResult.warning
        const fallbackResult = await renderPageToSvg(page, width, height)
        logger.info('[pdfImport] attempting local vector fallback', {
          file: file.name,
          pageIndex: i - 1,
          backendErrorCode: vectorResult.errorCode,
          backendWarning,
          fallbackHasSvg: !!fallbackResult.svg,
          fallbackWarning: fallbackResult.warning,
        })
        const fallbackWarnings = [
          ...(backendWarning ? [backendWarning] : []),
          ...(fallbackResult.warning ? [fallbackResult.warning] : []),
        ]
        vectorResult = {
          ...fallbackResult,
          warning: fallbackWarnings.length > 0 ? fallbackWarnings.join(' ') : undefined,
        }
      }
    }
    const vectorSvg = vectorResult.svg
    const hasEmbeddedRasterImages = vectorResult.hasEmbeddedRasterImages ?? false
    const pageWarnings: string[] = []
    if (vectorResult.warnings?.length) pageWarnings.push(...vectorResult.warnings)
    // Keep backend/fallback diagnostics in console when vector recovery succeeds.
    // Only show warning in UI when we still have no vector output.
    if (vectorResult.warning && !vectorSvg) {
      pageWarnings.push(vectorResult.warning)
    }
    if (vectorSvg) {
      const inlined = await inlineSvgEmbeddedImages(vectorSvg)
      const resolvedVectorSvg = inlined.svg
      if (inlined.hadUnresolvedImages) {
        pageWarnings.push('Some embedded images could not be resolved in vector output.')
      }
      pages.push({
        pageIndex: i - 1,
        pageCount,
        width,
        height,
        previewDataUrl,
        rasterDataUrl,
        vectorSvg: resolvedVectorSvg,
        hasEmbeddedRasterImages: hasEmbeddedRasterImages || inlined.hadEmbeddedImages,
        warnings: pageWarnings,
      })
      continue
    }
    if (!vectorSvg && ENABLE_PDF_VECTOR_CONVERSION) {
      pageWarnings.push('Vector extraction not available for this page. Raster fallback will be used.')
    }
    pages.push({
      pageIndex: i - 1,
      pageCount,
      width,
      height,
      previewDataUrl,
      rasterDataUrl,
      vectorSvg,
      hasEmbeddedRasterImages,
      warnings: pageWarnings,
    })
  }

  await doc.destroy()

  return {
    fileName: file.name,
    pageCount,
    pages,
    warnings,
  }
}

async function cropDataUrl(
  dataUrl: string,
  crop: PdfImportCropBox,
  pageSize: { width: number; height: number },
): Promise<string> {
  const img = new Image()
  await new Promise<void>((resolve, reject) => {
    img.onload = () => resolve()
    img.onerror = () => reject(new Error('Failed to load image for crop'))
    img.src = dataUrl
  })
  const imageCrop = mapPageCropToImageCrop(crop, pageSize, { width: img.width, height: img.height })
  const clamped = normalizeCropBox(imageCrop, { width: img.width, height: img.height })
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(clamped.width)
  canvas.height = Math.round(clamped.height)
  const context = canvas.getContext('2d')
  if (!context) throw new Error('Failed to create crop context')
  context.drawImage(
    img,
    clamped.x,
    clamped.y,
    clamped.width,
    clamped.height,
    0,
    0,
    clamped.width,
    clamped.height
  )
  return canvas.toDataURL('image/png')
}

function cropSvg(svgContent: string, crop: PdfImportCropBox, page: { width: number; height: number }): string {
  const clamped = normalizeCropBox(crop, page)
  const parser = new DOMParser()
  const doc = parser.parseFromString(svgContent, 'image/svg+xml')
  const svg = doc.documentElement
  svg.setAttribute('viewBox', `${clamped.x} ${clamped.y} ${clamped.width} ${clamped.height}`)
  svg.setAttribute('width', String(clamped.width))
  svg.setAttribute('height', String(clamped.height))
  return new XMLSerializer().serializeToString(svg)
}

export async function normalizePdfPageAsset(
  page: PdfImportPageCandidate,
  sourceName: string,
  crop?: PdfImportCropBox
): Promise<NormalizedPdfPageAsset> {
  const pageRect = { width: page.width, height: page.height }
  const effectiveCrop = crop ? normalizeCropBox(crop, pageRect) : undefined
  const previewDataUrl = effectiveCrop
    ? await cropDataUrl(page.previewDataUrl, effectiveCrop, pageRect)
    : page.previewDataUrl
  const rasterDataUrl = effectiveCrop
    ? await cropDataUrl(page.rasterDataUrl, effectiveCrop, pageRect)
    : page.rasterDataUrl

  if (page.vectorSvg) {
    const svgContent = effectiveCrop ? cropSvg(page.vectorSvg, effectiveCrop, pageRect) : page.vectorSvg
    return {
      kind: 'pdf-vector',
      pageIndex: page.pageIndex,
      pageCount: page.pageCount,
      width: effectiveCrop?.width ?? page.width,
      height: effectiveCrop?.height ?? page.height,
      sourceName,
      svgContent,
      dataUrl: rasterDataUrl,
      previewDataUrl,
      crop: effectiveCrop,
      warnings: page.warnings,
    }
  }

  return {
    kind: 'pdf-raster',
    pageIndex: page.pageIndex,
    pageCount: page.pageCount,
    width: effectiveCrop?.width ?? page.width,
    height: effectiveCrop?.height ?? page.height,
    sourceName,
    dataUrl: rasterDataUrl,
    previewDataUrl,
    crop: effectiveCrop,
    warnings: page.warnings,
  }
}
