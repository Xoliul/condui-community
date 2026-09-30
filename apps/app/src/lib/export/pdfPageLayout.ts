import { INFO_BLOCK_HEIGHT, INFO_BLOCK_TOTAL_WIDTH } from '@/lib/infoBlockLayout'
import { layoutRectsOverlap } from '@/lib/layout/oneWireBlockLayout'
import {
  A4_LANDSCAPE,
  A4_PORTRAIT,
  getChromeScale,
  getPageDimensions,
  PAGE_MARGIN,
  type ExportPaperSize,
} from './pageSizes'

export const INFO_BLOCK_GAP_MM = 2
export const PANEL_TITLE_HEIGHT_MM = 10
/** QR image edge length in the top-right reference link. */
export const REFERENCE_IMAGE_SIZE_MM = 12.75
/** QR + hostname under it, top-right. Keep in sync with pdfComposer reference link. */
export const EENDRAAD_QR_STACK_HEIGHT_MM = 12.75 + 1.2 + 5
export const EENDRAAD_TOP_CHROME_HEIGHT_MM = Math.max(
  PANEL_TITLE_HEIGHT_MM,
  EENDRAAD_QR_STACK_HEIGHT_MM,
)

/** Keep the info box secondary to the schematic; do not stretch it to half the sheet. */
const INFO_BLOCK_MAX_WIDTH_MM = 96

/** Title band height for the paper size (chrome shrinks on A3). */
export function getPanelTitleHeightMm(paperSize: ExportPaperSize = 'A4'): number {
  return PANEL_TITLE_HEIGHT_MM * getChromeScale(paperSize)
}

/** Top band (title and QR) that the one-wire schematic starts below. */
export function getEendraadTopChromeHeightMm(paperSize: ExportPaperSize = 'A4'): number {
  return EENDRAAD_TOP_CHROME_HEIGHT_MM * getChromeScale(paperSize)
}

export function getInfoBlockReservedZoneMm(
  orientation: 'landscape' | 'portrait',
  nativeWidth = INFO_BLOCK_TOTAL_WIDTH,
  paperSize: ExportPaperSize = 'A4'
): { widthMm: number; heightMm: number } {
  // The info box has the same absolute width cap on every sheet; A3 shrinks it
  // so it takes a smaller share of the larger page.
  const landscapeUsableWidth = A4_LANDSCAPE.width - PAGE_MARGIN * 2
  const reservedWidthMm =
    Math.min(landscapeUsableWidth * 0.36, INFO_BLOCK_MAX_WIDTH_MM) * getChromeScale(paperSize)
  const aspect = INFO_BLOCK_HEIGHT / nativeWidth
  if (orientation === 'landscape') {
    return { widthMm: reservedWidthMm, heightMm: reservedWidthMm * aspect }
  }
  const portraitUsableWidth = A4_PORTRAIT.width - PAGE_MARGIN * 2
  const widthMm = Math.min(reservedWidthMm, portraitUsableWidth)
  return { widthMm, heightMm: widthMm * aspect }
}

export function getPdfContentHeightMm(
  orientation: 'landscape' | 'portrait',
  options: {
    hasInfoBlock: boolean
    hasPanelTitle: boolean
    infoBlockNativeWidth?: number
    paperSize?: ExportPaperSize
  }
): number {
  const paperSize = options.paperSize ?? 'A4'
  const page = getPageDimensions(orientation, paperSize)
  const usableHeight = page.height - PAGE_MARGIN * 2
  let height = usableHeight - (options.hasPanelTitle ? getPanelTitleHeightMm(paperSize) : 0)
  if (options.hasInfoBlock) {
    height -=
      getInfoBlockReservedZoneMm(orientation, options.infoBlockNativeWidth, paperSize).heightMm +
      INFO_BLOCK_GAP_MM
  }
  return Math.max(20, height)
}

/**
 * Max paint area below the title/QR band. The info box is a separate
 * bottom-right obstacle; scale must clear it via
 * `limitEendraadScaleToInfoBlockCollision`.
 */
export function getEendraadSchematicAreaMm(
  orientation: 'landscape' | 'portrait',
  paperSize: ExportPaperSize = 'A4'
): {
  widthMm: number
  heightMm: number
} {
  const page = getPageDimensions(orientation, paperSize)
  return {
    widthMm: page.width - PAGE_MARGIN * 2,
    heightMm: Math.max(
      20,
      page.height - PAGE_MARGIN * 2 - getEendraadTopChromeHeightMm(paperSize)
    ),
  }
}

export function getEendraadSchematicTopMm(paperSize: ExportPaperSize = 'A4'): number {
  return PAGE_MARGIN + getEendraadTopChromeHeightMm(paperSize)
}

/** PDF info-box rectangle used as a one-wire collision obstacle. */
export function getEendraadInfoBlockObstacleMm(
  orientation: 'landscape' | 'portrait' = 'landscape',
  nativeWidth?: number,
  paperSize: ExportPaperSize = 'A4'
): { x: number; y: number; width: number; height: number } {
  const page = getPageDimensions(orientation, paperSize)
  const reserved = getInfoBlockReservedZoneMm(orientation, nativeWidth, paperSize)
  return {
    x: page.width - PAGE_MARGIN - reserved.widthMm,
    y: page.height - PAGE_MARGIN - reserved.heightMm,
    width: reserved.widthMm,
    height: reserved.heightMm,
  }
}

/**
 * Shrink a candidate scale until a full-width schematic of `packHeightPx`
 * clears the info-box obstacle. The bus runs along the bottom of every page,
 * so the reserved corner is a real collision, not overlay space.
 */
export function limitEendraadScaleToInfoBlockCollision(
  packHeightPx: number,
  scale: number,
  nativeWidth?: number,
  paperSize: ExportPaperSize = 'A4'
): number {
  const height = Math.max(packHeightPx, 1)
  const area = getEendraadSchematicAreaMm('landscape', paperSize)
  const obstacle = getEendraadInfoBlockObstacleMm('landscape', nativeWidth, paperSize)
  const topMm = getEendraadSchematicTopMm(paperSize)
  let next = scale
  const schematicRect = () => ({
    x: PAGE_MARGIN,
    y: topMm,
    width: area.widthMm,
    height: height * next,
  })
  if (layoutRectsOverlap(schematicRect(), obstacle, INFO_BLOCK_GAP_MM)) {
    next = Math.min(next, (obstacle.y - INFO_BLOCK_GAP_MM - topMm) / height)
  }
  return Math.max(0.01, next)
}
