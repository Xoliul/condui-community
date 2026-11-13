import i18n from '@/i18n'

const SVG_NS = 'http://www.w3.org/2000/svg'
/** Shared tilt of every limited-export mark (the Condui logo and the inspection stamps). */
export const LIMITED_MARK_ANGLE_DEG = -22.5
/** The repeated stamp over the info block nearly hides the installer and address fields. */
const INFO_BLOCK_STAMP_OPACITY = 0.75
/** The faint stamp tiled across the whole page. */
const PAGE_STAMP_OPACITY = 0.1
const CORNER_STAMP_OPACITY = 0.9
const STAMP_SEPARATOR = '   ·   '

export interface LimitedInspectionStampOptions {
  pageWidthMm: number
  pageMarginMm: number
  chromeScale: number
  textColor: string
  /** Reserved info block zone in page millimetres, when the page has one. */
  infoBlock?: { x: number; y: number; width: number; height: number } | null
}

export function getNotForInspectionLabel(): string {
  return i18n.t('export.notForInspection', 'Not for inspection').toLocaleUpperCase(i18n.language)
}

function createText(doc: Document, label: string, fontSize: number, color: string): SVGTextElement {
  const text = doc.createElementNS(SVG_NS, 'text')
  text.setAttribute('font-family', 'sans-serif')
  text.setAttribute('font-weight', '800')
  text.setAttribute('font-size', String(fontSize))
  text.setAttribute('fill', color)
  text.textContent = label
  return text
}

/**
 * Adds the "not for inspection" marks of a limited export to a page SVG before it is
 * rasterized: a label in the top-right margin and a repeated pattern across the whole
 * info block, so removing it from the bitmap also removes the installer and address fields.
 */
export function appendLimitedInspectionStamps(
  doc: Document,
  pageSvg: SVGSVGElement,
  options: LimitedInspectionStampOptions
): void {
  const label = getNotForInspectionLabel()
  const { pageWidthMm, pageMarginMm, chromeScale, textColor, infoBlock } = options

  const corner = createText(doc, label, 4.2 * chromeScale, textColor)
  corner.setAttribute('x', String(pageWidthMm - pageMarginMm))
  corner.setAttribute('y', String(pageMarginMm - 3 * chromeScale))
  corner.setAttribute('text-anchor', 'end')
  corner.setAttribute('opacity', String(CORNER_STAMP_OPACITY))
  pageSvg.appendChild(corner)

  if (!infoBlock || infoBlock.width <= 0 || infoBlock.height <= 0) return

  const clipId = 'limitedStampClip-' + Math.random().toString(36).slice(2, 10)
  const defs = doc.createElementNS(SVG_NS, 'defs')
  const clipPath = doc.createElementNS(SVG_NS, 'clipPath')
  clipPath.setAttribute('id', clipId)
  const clipRect = doc.createElementNS(SVG_NS, 'rect')
  clipRect.setAttribute('x', String(infoBlock.x))
  clipRect.setAttribute('y', String(infoBlock.y))
  clipRect.setAttribute('width', String(infoBlock.width))
  clipRect.setAttribute('height', String(infoBlock.height))
  clipPath.appendChild(clipRect)
  defs.appendChild(clipPath)
  pageSvg.appendChild(defs)

  const fontSize = Math.max(2.4, infoBlock.height / 7)
  const rowGap = fontSize * 1.9
  const repeated = Array.from({ length: 12 }, () => label).join(STAMP_SEPARATOR)
  const centerX = infoBlock.x + infoBlock.width / 2
  const centerY = infoBlock.y + infoBlock.height / 2
  // Rows cover the rotated diagonal of the box so no corner is left unstamped.
  const reach = Math.hypot(infoBlock.width, infoBlock.height)

  const clipped = doc.createElementNS(SVG_NS, 'g')
  clipped.setAttribute('clip-path', `url(#${clipId})`)
  const pattern = doc.createElementNS(SVG_NS, 'g')
  pattern.setAttribute('opacity', String(INFO_BLOCK_STAMP_OPACITY))
  pattern.setAttribute('transform', `rotate(${LIMITED_MARK_ANGLE_DEG} ${centerX} ${centerY})`)
  let row = 0
  for (let y = centerY - reach / 2; y <= centerY + reach / 2 + rowGap; y += rowGap, row += 1) {
    const text = createText(doc, repeated, fontSize, textColor)
    // Stagger alternate rows like a stamp pattern.
    text.setAttribute('x', String(centerX - reach - (row % 2) * fontSize * 3))
    text.setAttribute('y', String(y))
    pattern.appendChild(text)
  }
  clipped.appendChild(pattern)
  pageSvg.appendChild(clipped)
}

type StampCanvasContext = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D

/**
 * Tiles a faint "not for inspection" stamp across a whole rendered page, at the same tilt
 * as the Condui logo, so no area of a limited page can be cropped out clean.
 */
export function drawLimitedInspectionPagePattern(
  context: StampCanvasContext,
  width: number,
  height: number,
  textColor: string
): void {
  const label = getNotForInspectionLabel()
  const fontSize = Math.max(10, Math.round(Math.min(width, height) * 0.03))
  const rowGap = fontSize * 3.2
  const reach = Math.hypot(width, height)
  context.save()
  context.globalAlpha = PAGE_STAMP_OPACITY
  context.fillStyle = textColor
  context.font = `800 ${fontSize}px sans-serif`
  context.textAlign = 'left'
  context.textBaseline = 'middle'
  context.translate(width / 2, height / 2)
  context.rotate((LIMITED_MARK_ANGLE_DEG * Math.PI) / 180)
  const unit = label + STAMP_SEPARATOR
  const unitWidth = Math.max(1, context.measureText(unit).width)
  const repeated = unit.repeat(Math.ceil((reach * 2) / unitWidth) + 1)
  let row = 0
  for (let y = -reach / 2; y <= reach / 2; y += rowGap, row += 1) {
    // Stagger alternate rows by half a stamp.
    context.fillText(repeated, -reach - (row % 2) * (unitWidth / 2), y)
  }
  context.restore()
}
