/**
 * Match eendraad wire line caps in exported SVG to the live canvas.
 */

import { XMLSerializer as XmlDomSerializer, type Element as XmlDomElement } from '@xmldom/xmldom'

const EENDRAAD_WIRE_STROKE_WIDTHS = new Set([2, 6])

interface MainBusGeometry {
  x: number
  y: number
  width: number
}

function serializeDocument(doc: Document): string {
  if (typeof globalThis.XMLSerializer !== 'undefined') {
    return new globalThis.XMLSerializer().serializeToString(doc)
  }
  return new XmlDomSerializer().serializeToString(doc as unknown as XmlDomElement)
}

function parseStrokeWidth(value: string | null): number | null {
  if (!value) return null
  const parsed = Number.parseFloat(value.replace(/px$/i, ''))
  return Number.isFinite(parsed) ? parsed : null
}

function parseNumbers(value: string | null): number[] {
  if (!value) return []
  return (value.match(/[-+]?(?:\d*\.\d+|\d+\.?)(?:[eE][-+]?\d+)?/g) ?? [])
    .map(Number)
    .filter(Number.isFinite)
}

function hasMainBusGeometry(shape: Element, mainBus: MainBusGeometry): boolean {
  const tagName = shape.tagName.toLowerCase()
  const values =
    tagName === 'line'
      ? [
          ...parseNumbers(shape.getAttribute('x1')),
          ...parseNumbers(shape.getAttribute('y1')),
          ...parseNumbers(shape.getAttribute('x2')),
          ...parseNumbers(shape.getAttribute('y2')),
        ]
      : parseNumbers(shape.getAttribute(tagName === 'polyline' ? 'points' : 'd'))
  if (values.length < 4) return false

  const [x1, y1, x2, y2] = values
  if (
    x1 == null ||
    y1 == null ||
    x2 == null ||
    y2 == null ||
    Math.abs(y1 - mainBus.y) > 0.5 ||
    Math.abs(y2 - mainBus.y) > 0.5
  ) {
    return false
  }

  const shapeLeft = Math.min(x1, x2)
  const shapeRight = Math.max(x1, x2)
  const busLeft = mainBus.x
  const busRight = mainBus.x + mainBus.width
  return shapeRight > busLeft && shapeLeft < busRight
}

/**
 * svgcanvas/Konva export can default wire paths to round caps. Preserve the
 * editor's round main bus while normalizing ordinary thick trunk wires to butt caps.
 */
export function fixEendraadWireLineCapsInExportSvg(
  svgString: string,
  options: {
    preserveRoundedThickCaps?: boolean
    mainBus?: MainBusGeometry
  } = {}
): string {
  const doc = new DOMParser().parseFromString(svgString, 'image/svg+xml')
  const parserError = doc.querySelector('parsererror')
  if (parserError) return svgString

  const shapes = doc.querySelectorAll('path, line, polyline')
  shapes.forEach((shape) => {
    const strokeWidth = parseStrokeWidth(shape.getAttribute('stroke-width'))
    if (strokeWidth == null || !EENDRAAD_WIRE_STROKE_WIDTHS.has(strokeWidth)) return
    if (!shape.getAttribute('stroke')) return
    if (
      (options.preserveRoundedThickCaps === true ||
        (options.mainBus != null && hasMainBusGeometry(shape, options.mainBus))) &&
      strokeWidth === 6 &&
      shape.getAttribute('stroke-linecap') === 'round'
    ) {
      return
    }
    shape.setAttribute('stroke-linecap', 'butt')
  })

  return serializeDocument(doc)
}
