/**
 * PDF page composition
 * Handles adding SVG content to PDF pages with proper scaling and positioning.
 * The info block is a bottom-right obstacle. One-wire schematics sit below the
 * title/QR and scale down until that reserved rectangle is clear.
 */

import type { jsPDF } from 'jspdf'
import { svg2pdf } from 'svg2pdf.js'
import type {
  ExportPage,
  ExportDiagnostic,
  ComposedPagePlacement,
  ExportPageReference,
  ExportTheme,
} from './types'
import { getChromeScale, getPageDimensions, PAGE_MARGIN, type ExportPaperSize } from './pageSizes'
import { getExportFontFamily } from './fontPostProcessor'
import { INFO_BLOCK_HEIGHT } from '@/lib/infoBlockLayout'
import { exportLog } from './exportLogger'
import {
  getEendraadInfoBlockObstacleMm,
  getEendraadSchematicAreaMm,
  INFO_BLOCK_GAP_MM,
  getPanelTitleHeightMm,
  REFERENCE_IMAGE_SIZE_MM,
  getEendraadSchematicTopMm,
  getInfoBlockReservedZoneMm,
  getPdfContentHeightMm,
  limitEendraadScaleToInfoBlockCollision,
} from './pdfPageLayout'
import { getThemeColors } from '@/lib/theme/colors'
import { drawLimitedWatermark, LIMITED_RASTER_JPEG_QUALITY } from './limitedWatermark'

const REFERENCE_LABEL_GAP_MM = 1.2
const REFERENCE_URL_FONT_SIZE_PT = 5

function getEendraadSchematicPlacement(
  bounds: { x: number; y: number; width: number; height: number; space?: 'scene' },
  globalScale: number,
  paperSize: ExportPaperSize = 'A4',
): {
  scale: number
  viewBox: string
  scaledWidth: number
  scaledHeight: number
  x: number
  y: number
  fitBounds: { x: number; y: number; width: number; height: number; space: 'scene' }
} {
  const { widthMm: contentWidth } = getEendraadSchematicAreaMm('landscape', paperSize)
  // Never shrink to fit a wide leftover. Clip horizontally instead so symbols
  // stay large relative to the title and QR. Vertical scale must still clear
  // the info-box obstacle because the bus occupies the bottom of every page.
  const scale = limitEendraadScaleToInfoBlockCollision(bounds.height, globalScale, undefined, paperSize)
  const viewWidth = Math.min(bounds.width, contentWidth / Math.max(scale, 0.01))
  const scaledWidth = viewWidth * scale
  const scaledHeight = bounds.height * scale
  // Center a short schematic in the sheet instead of pinning it under the title,
  // but never let it slide down into the info box.
  const topMm = getEendraadSchematicTopMm(paperSize)
  const area = getEendraadSchematicAreaMm('landscape', paperSize)
  const obstacleTop = getEendraadInfoBlockObstacleMm('landscape', undefined, paperSize).y
  const clearance = Math.max(0, obstacleTop - INFO_BLOCK_GAP_MM - topMm - scaledHeight)
  const offsetY = Math.min(Math.max(0, (area.heightMm - scaledHeight) / 2), clearance)
  return {
    scale,
    viewBox: `${bounds.x} ${bounds.y} ${viewWidth} ${bounds.height}`,
    scaledWidth,
    scaledHeight,
    x: PAGE_MARGIN + (contentWidth - scaledWidth) / 2,
    y: topMm + offsetY,
    fitBounds: {
      x: bounds.x,
      y: bounds.y,
      width: viewWidth,
      height: bounds.height,
      space: 'scene',
    },
  }
}
const LIMITED_RASTER_DPI = 174

/**
 * When provided, the info block is drawn in the bottom-right of the page and
 * the main content is confined to the area above it (no overlap).
 */
export interface PdfPageInfoBlock {
  /** Pre-built SVG string for the info block (from buildInfoBlockSvg). */
  svgString: string
  /** Native SVG width; used to reserve the correct aspect-ratio-aware page zone. */
  nativeWidth: number
}

function addReferenceLinkToPdf(
  pdf: jsPDF,
  referenceLink: ExportPageReference,
  pageWidth: number,
  exportTheme: ExportTheme,
  paperSize: ExportPaperSize = 'A4'
): void {
  const chrome = getChromeScale(paperSize)
  const imageSize = REFERENCE_IMAGE_SIZE_MM * chrome
  const colors = getThemeColors(exportTheme)
  const imageX = pageWidth - PAGE_MARGIN - imageSize
  const imageY = PAGE_MARGIN
  const labelX = imageX + imageSize / 2
  const labelY = imageY + imageSize + (REFERENCE_LABEL_GAP_MM + 1.8) * chrome

  pdf.addImage(
    referenceLink.imageDataUrl,
    'PNG',
    imageX,
    imageY,
    imageSize,
    imageSize
  )
  pdf.link(imageX, imageY, imageSize, imageSize, {
    url: referenceLink.url,
  })
  pdf.setFont(getExportFontFamily(), 'normal')
  pdf.setFontSize(REFERENCE_URL_FONT_SIZE_PT * chrome)
  pdf.setTextColor(colors.secondaryText)
  pdf.text(referenceLink.displayHost, labelX, labelY, {
    align: 'center',
    maxWidth: imageSize + 4 * chrome,
  })
  pdf.setTextColor(colors.textColor)
}

function paintPdfPageBackground(
  pdf: jsPDF,
  pageWidth: number,
  pageHeight: number,
  exportTheme: ExportTheme
): void {
  pdf.setFillColor(getThemeColors(exportTheme).background)
  pdf.rect(0, 0, pageWidth, pageHeight, 'F')
}

/**
 * Compute reserved zone for the info block (bottom-right). Same scale on all pages:
 * landscape = half usable width; portrait = same physical size (capped by page width).
 */
/**
 * Compose a PDF page from an SVG string
 *
 * @param pdf jsPDF document instance
 * @param svgString SVG string to add (main diagram/content)
 * @param page Export page descriptor
 * @param diagnostics Diagnostics array to append errors to
 * @param infoBlock When provided, drawn in bottom-right; main content is scaled to avoid overlap
 * @param panelTitle When provided (eendraad slice pages), drawn in top-left; content is shifted down
 */
export async function composePdfPage(
  pdf: jsPDF,
  svgString: string,
  page: ExportPage,
  diagnostics: ExportDiagnostic[],
  infoBlock?: PdfPageInfoBlock | null,
  panelTitle?: string | null,
  referenceLink?: ExportPageReference | null,
  exportTheme: ExportTheme = 'light'
): Promise<ComposedPagePlacement | null> {
  try {
    // Reset jsPDF font state at the start of every composed page so that
    // bold/italic settings from previous pages (e.g. circuit notes overlays)
    // don't leak into svg2pdf's text rendering on this page.
    const exportFontFamily = getExportFontFamily()
    pdf.setFont(exportFontFamily, 'normal')

    const orientation: 'landscape' | 'portrait' =
      page.orientation ||
      (page.scene.bounds.width > page.scene.bounds.height ? 'landscape' : 'portrait')

    const paperSize: ExportPaperSize = page.pageSize ?? 'A4'
    const { width: pageWidth, height: pageHeight } = getPageDimensions(orientation, paperSize)
    const themeColors = getThemeColors(exportTheme)
    paintPdfPageBackground(pdf, pageWidth, pageHeight, exportTheme)
    const usableWidth = pageWidth - PAGE_MARGIN * 2
    const contentWidth = usableWidth
    const contentHeight = getPdfContentHeightMm(orientation, {
      hasInfoBlock: !!infoBlock?.svgString,
      hasPanelTitle: !!panelTitle,
      infoBlockNativeWidth: infoBlock?.nativeWidth,
      paperSize,
    })
    const contentX = PAGE_MARGIN
    let contentY = PAGE_MARGIN

    if (panelTitle) {
      contentY = PAGE_MARGIN + getPanelTitleHeightMm(paperSize)
    }

    const bounds = page.scene.bounds
    const isEendraadSlice = !!page.scene.eendraadSlice
    const eendraadPlacement = isEendraadSlice
      ? getEendraadSchematicPlacement(bounds, page.scene.eendraadSlice!.globalScale, paperSize)
      : null
    const scale = eendraadPlacement
      ? eendraadPlacement.scale
      : Math.min(contentWidth / bounds.width, contentHeight / bounds.height)
    const scaledWidth = eendraadPlacement?.scaledWidth ?? bounds.width * scale
    const scaledHeight = eendraadPlacement?.scaledHeight ?? bounds.height * scale
    const x = eendraadPlacement?.x ?? contentX + (contentWidth - scaledWidth) / 2
    const y = eendraadPlacement?.y ?? contentY + (contentHeight - scaledHeight) / 2
    const viewBox = eendraadPlacement?.viewBox ?? `${bounds.x} ${bounds.y} ${bounds.width} ${bounds.height}`

    exportLog(
      `[Export] Composing page: content area ${contentWidth.toFixed(0)}x${contentHeight.toFixed(0)}mm, scaled ${scaledWidth.toFixed(2)}x${scaledHeight.toFixed(2)}mm at (${x.toFixed(2)}, ${y.toFixed(2)})mm`
    )

    const parser = new DOMParser()
    const svgDoc = parser.parseFromString(svgString, 'image/svg+xml')
    const svgElement = svgDoc.documentElement

    svgElement.setAttribute('viewBox', viewBox)
    svgElement.setAttribute('preserveAspectRatio', 'xMidYMid meet')
    svgElement.setAttribute('width', `${scaledWidth}`)
    svgElement.setAttribute('height', `${scaledHeight}`)

    const positionedSvg = svgDoc.createElementNS('http://www.w3.org/2000/svg', 'svg')
    positionedSvg.setAttribute('width', `${pageWidth}mm`)
    positionedSvg.setAttribute('height', `${pageHeight}mm`)
    positionedSvg.setAttribute('viewBox', `0 0 ${pageWidth} ${pageHeight}`)

    if (panelTitle) {
      const titleText = svgDoc.createElementNS('http://www.w3.org/2000/svg', 'text')
      titleText.setAttribute('x', String(PAGE_MARGIN))
      titleText.setAttribute('y', String(PAGE_MARGIN + 4 * getChromeScale(paperSize)))
      titleText.setAttribute('font-size', String(3.5 * getChromeScale(paperSize)))
      titleText.setAttribute('font-weight', 'bold')
      titleText.setAttribute('font-family', 'sans-serif')
      titleText.setAttribute('fill', themeColors.textColor)
      titleText.textContent = panelTitle
      positionedSvg.appendChild(titleText)
    }

    const positionedGroup = svgDoc.createElementNS('http://www.w3.org/2000/svg', 'g')
    positionedGroup.setAttribute('transform', `translate(${x}, ${y})`)
    const contentSvg = svgDoc.createElementNS('http://www.w3.org/2000/svg', 'svg')
    contentSvg.setAttribute('width', `${scaledWidth}`)
    contentSvg.setAttribute('height', `${scaledHeight}`)
    contentSvg.setAttribute('viewBox', viewBox)
    contentSvg.setAttribute('preserveAspectRatio', 'xMidYMid meet')
    // Ensure diagram text (including technical labels) starts from a clean font state.
    // Any explicit bold/italic from the original SVG is preserved on the individual <text> nodes.
    contentSvg.setAttribute('font-weight', 'normal')
    contentSvg.setAttribute('font-style', 'normal')
    while (svgElement.firstChild) {
      contentSvg.appendChild(svgElement.firstChild)
    }

    // Normalize text nodes so inherited bold/italic from groups (e.g. panel titles)
    // does not leak into technical labels or other neutral text.
    const textNodes = contentSvg.querySelectorAll('text')
    textNodes.forEach((textEl) => {
      // If a text node doesn't explicitly opt into italic, force it back to normal
      // so any parent/group font-style doesn't leak.
      const fontStyleAttr = textEl.getAttribute('font-style')
      if (!fontStyleAttr) {
        textEl.setAttribute('font-style', 'normal')
      }
      // If a text node doesn't have its own font-weight, let it inherit "normal"
      // from contentSvg; explicit bold nodes keep their own font-weight.
      // (No change needed when font-weight is already present.)
    })
    if (page.scene.contentClipRect) {
      const clip = page.scene.contentClipRect
      const clipId = 'sliceClip-' + Math.random().toString(36).slice(2, 10)
      const defs = svgDoc.createElementNS('http://www.w3.org/2000/svg', 'defs')
      const clipPath = svgDoc.createElementNS('http://www.w3.org/2000/svg', 'clipPath')
      clipPath.setAttribute('id', clipId)
      const clipRect = svgDoc.createElementNS('http://www.w3.org/2000/svg', 'rect')
      clipRect.setAttribute('x', String(clip.x))
      clipRect.setAttribute('y', String(clip.y))
      clipRect.setAttribute('width', String(clip.width))
      clipRect.setAttribute('height', String(clip.height))
      clipPath.appendChild(clipRect)
      defs.appendChild(clipPath)

      const clipGroup = svgDoc.createElementNS('http://www.w3.org/2000/svg', 'g')
      clipGroup.setAttribute('clip-path', `url(#${clipId})`)

      while (contentSvg.firstChild) {
        const child = contentSvg.firstChild as Element
        contentSvg.removeChild(child)
        clipGroup.appendChild(child)
      }

      contentSvg.appendChild(defs)
      contentSvg.appendChild(clipGroup)
    }
    positionedGroup.appendChild(contentSvg)
    positionedSvg.appendChild(positionedGroup)

    if (infoBlock?.svgString) {
      const { widthMm: boxW, heightMm: boxH } = getInfoBlockReservedZoneMm(
        orientation,
        infoBlock.nativeWidth,
        paperSize
      )
      const boxX = pageWidth - PAGE_MARGIN - boxW
      const boxY = pageHeight - PAGE_MARGIN - boxH
      const infoBlockSvgDoc = parser.parseFromString(infoBlock.svgString, 'image/svg+xml')
      const infoBlockSvgEl = infoBlockSvgDoc.documentElement
      infoBlockSvgEl.setAttribute('width', `${boxW}`)
      infoBlockSvgEl.setAttribute('height', `${boxH}`)
      infoBlockSvgEl.setAttribute('preserveAspectRatio', 'xMidYMid meet')
      const infoGroup = svgDoc.createElementNS('http://www.w3.org/2000/svg', 'g')
      infoGroup.setAttribute('transform', `translate(${boxX}, ${boxY})`)
      const infoInner = svgDoc.createElementNS('http://www.w3.org/2000/svg', 'svg')
      infoInner.setAttribute('width', `${boxW}`)
      infoInner.setAttribute('height', `${boxH}`)
      infoInner.setAttribute('viewBox', `0 0 ${infoBlock.nativeWidth} ${INFO_BLOCK_HEIGHT}`)
      infoInner.setAttribute('preserveAspectRatio', 'xMidYMid meet')
      while (infoBlockSvgEl.firstChild) {
        const node = infoBlockSvgEl.firstChild
        infoInner.appendChild(svgDoc.importNode(node, true))
        node.remove()
      }
      infoGroup.appendChild(infoInner)
      positionedSvg.appendChild(infoGroup)
    }

    await svg2pdf(positionedSvg, pdf, {
      width: pageWidth,
      height: pageHeight,
    })

    if (referenceLink) {
      addReferenceLinkToPdf(pdf, referenceLink, pageWidth, exportTheme, paperSize)
    }

    return {
      contentX: x,
      contentY: y,
      contentWidth: scaledWidth,
      contentHeight: scaledHeight,
      fitBounds: eendraadPlacement?.fitBounds ?? bounds,
      scale,
    }
  } catch (error) {
    diagnostics.push({
      level: 'error',
      code: 'PDF_COMPOSE_FAILED',
      pageId: page.id,
      message: `Failed to compose PDF page: ${error instanceof Error ? error.message : String(error)}`,
      details: { error },
    })
    throw error
  }
}

function mmToRasterPx(mm: number): number {
  return Math.max(1, Math.round((mm / 25.4) * LIMITED_RASTER_DPI))
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image()
    image.onload = () => resolve(image)
    image.onerror = () => reject(new Error(`Could not load image: ${src}`))
    image.src = src
  })
}

function grayscaleCanvasInPlace(canvas: HTMLCanvasElement): void {
  const context = canvas.getContext('2d')
  if (!context) return
  const imageData = context.getImageData(0, 0, canvas.width, canvas.height)
  const data = imageData.data
  for (let index = 0; index < data.length; index += 4) {
    const gray = Math.round(
      data[index]! * 0.299 + data[index + 1]! * 0.587 + data[index + 2]! * 0.114
    )
    const indexed = Math.round(gray / 32) * 32
    data[index] = indexed
    data[index + 1] = indexed
    data[index + 2] = indexed
  }
  context.putImageData(imageData, 0, 0)
}

async function addLimitedWatermark(
  canvas: HTMLCanvasElement,
  exportTheme: ExportTheme
): Promise<void> {
  const context = canvas.getContext('2d')
  if (!context) return
  await drawLimitedWatermark(
    context,
    canvas.width,
    canvas.height,
    getThemeColors(exportTheme).textColor
  )
}

async function rasterizeSvgPageToDataUrl(
  positionedSvg: SVGSVGElement,
  exportTheme: ExportTheme
): Promise<string> {
  const serializer = new XMLSerializer()
  const svgText = serializer.serializeToString(positionedSvg)
  const blob = new Blob([svgText], { type: 'image/svg+xml;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  try {
    const image = await loadImage(url)
    const widthPx = mmToRasterPx(Number(positionedSvg.getAttribute('data-page-width-mm') ?? '210'))
    const heightPx = mmToRasterPx(
      Number(positionedSvg.getAttribute('data-page-height-mm') ?? '297')
    )
    const canvas = document.createElement('canvas')
    canvas.width = widthPx
    canvas.height = heightPx
    const context = canvas.getContext('2d')
    if (!context) throw new Error('Could not create raster export canvas')
    context.drawImage(image, 0, 0, widthPx, heightPx)
    grayscaleCanvasInPlace(canvas)
    await addLimitedWatermark(canvas, exportTheme)
    context.save()
    context.globalCompositeOperation = 'destination-over'
    context.fillStyle = getThemeColors(exportTheme).background
    context.fillRect(0, 0, widthPx, heightPx)
    context.restore()
    return canvas.toDataURL('image/jpeg', LIMITED_RASTER_JPEG_QUALITY)
  } finally {
    URL.revokeObjectURL(url)
  }
}

/**
 * Compose a locked-project PDF page as a single low-resolution grayscale raster image.
 * This intentionally avoids svg2pdf so the exported page does not contain vector SVG content.
 */
export async function composeLimitedRasterPdfPage(
  pdf: jsPDF,
  svgString: string,
  page: ExportPage,
  diagnostics: ExportDiagnostic[],
  infoBlock?: PdfPageInfoBlock | null,
  panelTitle?: string | null,
  exportTheme: ExportTheme = 'light'
): Promise<ComposedPagePlacement | null> {
  try {
    const orientation: 'landscape' | 'portrait' =
      page.orientation ||
      (page.scene.bounds.width > page.scene.bounds.height ? 'landscape' : 'portrait')

    const paperSize: ExportPaperSize = page.pageSize ?? 'A4'
    const { width: pageWidth, height: pageHeight } = getPageDimensions(orientation, paperSize)
    const themeColors = getThemeColors(exportTheme)
    const usableWidth = pageWidth - PAGE_MARGIN * 2
    const contentWidth = usableWidth
    const contentHeight = getPdfContentHeightMm(orientation, {
      hasInfoBlock: !!infoBlock?.svgString,
      hasPanelTitle: !!panelTitle,
      infoBlockNativeWidth: infoBlock?.nativeWidth,
      paperSize,
    })
    const contentX = PAGE_MARGIN
    let contentY = PAGE_MARGIN

    if (panelTitle) {
      contentY = PAGE_MARGIN + getPanelTitleHeightMm(paperSize)
    }

    const bounds = page.scene.bounds
    const isEendraadSlice = !!page.scene.eendraadSlice
    const eendraadPlacement = isEendraadSlice
      ? getEendraadSchematicPlacement(bounds, page.scene.eendraadSlice!.globalScale, paperSize)
      : null
    const scale = eendraadPlacement
      ? eendraadPlacement.scale
      : Math.min(contentWidth / bounds.width, contentHeight / bounds.height)
    const scaledWidth = eendraadPlacement?.scaledWidth ?? bounds.width * scale
    const scaledHeight = eendraadPlacement?.scaledHeight ?? bounds.height * scale
    const x = eendraadPlacement?.x ?? contentX + (contentWidth - scaledWidth) / 2
    const y = eendraadPlacement?.y ?? contentY + (contentHeight - scaledHeight) / 2
    const viewBox = eendraadPlacement?.viewBox ?? `${bounds.x} ${bounds.y} ${bounds.width} ${bounds.height}`

    const parser = new DOMParser()
    const svgDoc = parser.parseFromString(svgString, 'image/svg+xml')
    const svgElement = svgDoc.documentElement
    svgElement.setAttribute('viewBox', viewBox)
    svgElement.setAttribute('preserveAspectRatio', 'xMidYMid meet')

    const positionedSvg = svgDoc.createElementNS('http://www.w3.org/2000/svg', 'svg')
    positionedSvg.setAttribute('width', `${pageWidth}mm`)
    positionedSvg.setAttribute('height', `${pageHeight}mm`)
    positionedSvg.setAttribute('viewBox', `0 0 ${pageWidth} ${pageHeight}`)
    positionedSvg.setAttribute('data-page-width-mm', String(pageWidth))
    positionedSvg.setAttribute('data-page-height-mm', String(pageHeight))

    if (panelTitle) {
      const titleText = svgDoc.createElementNS('http://www.w3.org/2000/svg', 'text')
      titleText.setAttribute('x', String(PAGE_MARGIN))
      titleText.setAttribute('y', String(PAGE_MARGIN + 4 * getChromeScale(paperSize)))
      titleText.setAttribute('font-size', String(3.5 * getChromeScale(paperSize)))
      titleText.setAttribute('font-weight', 'bold')
      titleText.setAttribute('font-family', 'sans-serif')
      titleText.setAttribute('fill', themeColors.textColor)
      titleText.textContent = panelTitle
      positionedSvg.appendChild(titleText)
    }

    const positionedGroup = svgDoc.createElementNS('http://www.w3.org/2000/svg', 'g')
    positionedGroup.setAttribute('transform', `translate(${x}, ${y})`)
    const contentSvg = svgDoc.createElementNS('http://www.w3.org/2000/svg', 'svg')
    contentSvg.setAttribute('width', `${scaledWidth}`)
    contentSvg.setAttribute('height', `${scaledHeight}`)
    contentSvg.setAttribute('viewBox', viewBox)
    contentSvg.setAttribute('preserveAspectRatio', 'xMidYMid meet')
    contentSvg.setAttribute('font-weight', 'normal')
    contentSvg.setAttribute('font-style', 'normal')
    while (svgElement.firstChild) {
      contentSvg.appendChild(svgElement.firstChild)
    }
    if (page.scene.contentClipRect) {
      const clip = page.scene.contentClipRect
      const clipId = 'limitedSliceClip-' + Math.random().toString(36).slice(2, 10)
      const defs = svgDoc.createElementNS('http://www.w3.org/2000/svg', 'defs')
      const clipPath = svgDoc.createElementNS('http://www.w3.org/2000/svg', 'clipPath')
      clipPath.setAttribute('id', clipId)
      const clipRect = svgDoc.createElementNS('http://www.w3.org/2000/svg', 'rect')
      clipRect.setAttribute('x', String(clip.x))
      clipRect.setAttribute('y', String(clip.y))
      clipRect.setAttribute('width', String(clip.width))
      clipRect.setAttribute('height', String(clip.height))
      clipPath.appendChild(clipRect)
      defs.appendChild(clipPath)
      const clipGroup = svgDoc.createElementNS('http://www.w3.org/2000/svg', 'g')
      clipGroup.setAttribute('clip-path', `url(#${clipId})`)
      while (contentSvg.firstChild) {
        const child = contentSvg.firstChild as Element
        contentSvg.removeChild(child)
        clipGroup.appendChild(child)
      }
      contentSvg.appendChild(defs)
      contentSvg.appendChild(clipGroup)
    }
    positionedGroup.appendChild(contentSvg)
    positionedSvg.appendChild(positionedGroup)

    if (infoBlock?.svgString) {
      const { widthMm: boxW, heightMm: boxH } = getInfoBlockReservedZoneMm(
        orientation,
        infoBlock.nativeWidth,
        paperSize
      )
      const boxX = pageWidth - PAGE_MARGIN - boxW
      const boxY = pageHeight - PAGE_MARGIN - boxH
      const infoBlockSvgDoc = parser.parseFromString(infoBlock.svgString, 'image/svg+xml')
      const infoBlockSvgEl = infoBlockSvgDoc.documentElement
      const infoGroup = svgDoc.createElementNS('http://www.w3.org/2000/svg', 'g')
      infoGroup.setAttribute('transform', `translate(${boxX}, ${boxY})`)
      const infoInner = svgDoc.createElementNS('http://www.w3.org/2000/svg', 'svg')
      infoInner.setAttribute('width', `${boxW}`)
      infoInner.setAttribute('height', `${boxH}`)
      infoInner.setAttribute('viewBox', `0 0 ${infoBlock.nativeWidth} ${INFO_BLOCK_HEIGHT}`)
      infoInner.setAttribute('preserveAspectRatio', 'xMidYMid meet')
      while (infoBlockSvgEl.firstChild) {
        const node = infoBlockSvgEl.firstChild
        infoInner.appendChild(svgDoc.importNode(node, true))
        node.remove()
      }
      infoGroup.appendChild(infoInner)
      positionedSvg.appendChild(infoGroup)
    }

    const dataUrl = await rasterizeSvgPageToDataUrl(positionedSvg, exportTheme)
    pdf.addImage(dataUrl, 'JPEG', 0, 0, pageWidth, pageHeight)

    return {
      contentX: x,
      contentY: y,
      contentWidth: scaledWidth,
      contentHeight: scaledHeight,
      fitBounds: eendraadPlacement?.fitBounds ?? bounds,
      scale,
    }
  } catch (error) {
    diagnostics.push({
      level: 'error',
      code: 'PDF_COMPOSE_FAILED',
      pageId: page.id,
      message: `Failed to compose limited PDF page: ${error instanceof Error ? error.message : String(error)}`,
      details: { error },
    })
    throw error
  }
}

/**
 * Compose a full-page SVG without additional layout (used for legend or similar pages).
 */
export async function composeFullSvgPage(
  pdf: jsPDF,
  svgString: string,
  pageId: string,
  diagnostics: ExportDiagnostic[],
  orientation: 'portrait' | 'landscape' = 'portrait',
  exportTheme: ExportTheme = 'light'
): Promise<void> {
  try {
    const { width: pageWidth, height: pageHeight } = getPageDimensions(orientation)
    paintPdfPageBackground(pdf, pageWidth, pageHeight, exportTheme)

    const parser = new DOMParser()
    const svgDoc = parser.parseFromString(svgString, 'image/svg+xml')
    const svgElement = svgDoc.documentElement
    svgElement.setAttribute('width', `${pageWidth}`)
    svgElement.setAttribute('height', `${pageHeight}`)
    svgElement.setAttribute('viewBox', `0 0 ${pageWidth} ${pageHeight}`)

    await svg2pdf(svgElement, pdf, {
      width: pageWidth,
      height: pageHeight,
    })
  } catch (error) {
    diagnostics.push({
      level: 'error',
      code: 'PDF_COMPOSE_FAILED',
      pageId,
      message: `Failed to compose SVG page: ${error instanceof Error ? error.message : String(error)}`,
      details: { error },
    })
    throw error
  }
}

/**
 * Create a new PDF document with the specified page size
 * Re-exported from svgToPdf for convenience
 */
export { createPdfDocument } from './svgToPdf'
