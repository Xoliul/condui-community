/**
 * Page size constants and utilities for PDF export
 */

export const A4_PORTRAIT = { width: 210, height: 297 } // mm
export const A4_LANDSCAPE = { width: 297, height: 210 } // mm
export const A3_PORTRAIT = { width: 297, height: 420 } // mm
export const A3_LANDSCAPE = { width: 420, height: 297 } // mm
export const PAGE_MARGIN = 15 // mm - consistent safe margin for all canvases

export type PageSize = { width: number; height: number }

/** Paper formats the PDF export can produce. */
export type ExportPaperSize = 'A4' | 'A3'

/**
 * Chrome (info box, title band, QR code) is drawn smaller on A3 so that the
 * extra sheet area goes to the schematic instead of scaling every fixture up.
 */
export const A3_CHROME_SCALE = 0.85

export function getChromeScale(paperSize: ExportPaperSize = 'A4'): number {
  return paperSize === 'A3' ? A3_CHROME_SCALE : 1
}

export function getPageDimensions(
  orientation: 'landscape' | 'portrait',
  paperSize: ExportPaperSize = 'A4'
): PageSize {
  if (paperSize === 'A3') return orientation === 'landscape' ? A3_LANDSCAPE : A3_PORTRAIT
  return orientation === 'landscape' ? A4_LANDSCAPE : A4_PORTRAIT
}

/**
 * Get the usable area of a page (excluding margins)
 */
export function getUsableArea(pageSize: PageSize): { width: number; height: number } {
  return {
    width: pageSize.width - PAGE_MARGIN * 2,
    height: pageSize.height - PAGE_MARGIN * 2,
  }
}
