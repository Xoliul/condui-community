import type { PdfImportPageCandidate } from '@/lib/plan/pdfImport'
import { svgContentToDataUrl } from '@/utils/planImageProcessing'

/** A CAD layer shown in an import view, as reported by the DWG converter. */
export interface CadLayerInfo {
  name: string
  /** ByLayer CSS colour. */
  color: string
  /** Whether the layer is shown before the user toggles it (off/frozen/no-plot layers start hidden). */
  visible: boolean
}

export function parseCadLayerList(raw: unknown): CadLayerInfo[] {
  if (!Array.isArray(raw)) return []
  const layers: CadLayerInfo[] = []
  for (const entry of raw) {
    if (!entry || typeof entry !== 'object') continue
    const { name, color, visible } = entry as Record<string, unknown>
    if (typeof name !== 'string' || !name) continue
    layers.push({
      name,
      color: typeof color === 'string' ? color : '#111827',
      visible: visible !== false,
    })
  }
  return layers
}

/** Layer names hidden by default across all pages. */
export function getInitiallyHiddenCadLayers(pages: readonly PdfImportPageCandidate[]): Set<string> {
  const hidden = new Set<string>()
  for (const page of pages) {
    for (const layer of page.cadLayers ?? []) {
      if (!layer.visible) hidden.add(layer.name)
    }
  }
  return hidden
}

/** Unique layers across pages, sorted by name. */
export function mergeCadLayers(pages: readonly PdfImportPageCandidate[]): CadLayerInfo[] {
  const merged = new Map<string, CadLayerInfo>()
  for (const page of pages) {
    for (const layer of page.cadLayers ?? []) {
      if (!merged.has(layer.name)) merged.set(layer.name, layer)
    }
  }
  return [...merged.values()].sort((a, b) =>
    a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' })
  )
}

/** CAD colour 7 is white on dark and black on light backgrounds. */
export function isCadForegroundColor(color: string): boolean {
  return /^rgb\(\s*255\s*,\s*255\s*,\s*255\s*\)$/i.test(color) || /^#fff(fff)?$/i.test(color)
}

/**
 * Removes every element tagged with a hidden `data-layer`. Block definitions are
 * filtered too, so nested entities on a hidden layer disappear from every insert,
 * while layer-0 block contents (untagged) follow their insert's layer.
 */
export function filterCadSvgLayers(svgContent: string, hiddenLayers: ReadonlySet<string>): string {
  if (hiddenLayers.size === 0 || !svgContent.includes('data-layer')) return svgContent
  const doc = new DOMParser().parseFromString(svgContent, 'image/svg+xml')
  let removed = false
  for (const element of Array.from(doc.querySelectorAll('[data-layer]'))) {
    if (hiddenLayers.has(element.getAttribute('data-layer') ?? '') && element.isConnected) {
      element.remove()
      removed = true
    }
  }
  return removed ? new XMLSerializer().serializeToString(doc) : svgContent
}

/** Rebuilds a CAD page's SVG and previews from its unfiltered source with the given layers hidden. */
export function applyCadLayerVisibility(
  page: PdfImportPageCandidate,
  hiddenLayers: ReadonlySet<string>,
): PdfImportPageCandidate {
  if (!page.cadSourceSvg || !page.cadLayers?.length) return page
  const vectorSvg = filterCadSvgLayers(page.cadSourceSvg, hiddenLayers)
  if (vectorSvg === page.vectorSvg) return page
  const dataUrl = svgContentToDataUrl(vectorSvg)
  return { ...page, vectorSvg, previewDataUrl: dataUrl, rasterDataUrl: dataUrl }
}
