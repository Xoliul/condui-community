import { APP_SERVER_API_PATHS, fetchAppServerApi } from '@/lib/appServerApi'
import type { PdfImportPageCandidate } from '@/lib/plan/pdfImport'
import {
  buildCadImportPipelineContext,
  type CadImportPipelineContext,
} from '@/lib/plan/cadReferenceBuilder'
import type { CadMetadataHeader } from '@/lib/plan/cadCoordinateTransform'
import { filterCadSvgLayers, parseCadLayerList, type CadLayerInfo } from '@/lib/plan/cadLayers'
import { svgContentToDataUrl } from '@/utils/planImageProcessing'

const MAX_VECTOR_SVG_LENGTH = 12_000_000
const TARGET_LONG_EDGE_PX = 2400
const MIN_LONG_EDGE_PX = 1200

export interface CadParseResult {
  fileName: string
  pages: PdfImportPageCandidate[]
  warnings: string[]
  /** Pipeline of the first page; kept for callers that import a single CAD page. */
  cadImportPipeline?: CadImportPipelineContext
  /** One pipeline per page, keyed by page index. DWG layouts yield one page per viewport. */
  cadImportPipelinesByPage?: Record<number, CadImportPipelineContext>
}

interface CadServerView {
  label?: string | null
  svgContent: string
  layers?: unknown
}

function parseViewBox(svg: SVGSVGElement): { x: number; y: number; width: number; height: number } | null {
  const raw = svg.getAttribute('viewBox')
  if (raw) {
    const parts = raw.split(/[\s,]+/).map(Number).filter(Number.isFinite)
    const [x, y, width, height] = parts
    if (
      x != null &&
      y != null &&
      width != null &&
      height != null &&
      parts.length === 4 &&
      width > 0 &&
      height > 0
    ) {
      return { x, y, width, height }
    }
  }

  const width = Number(String(svg.getAttribute('width') ?? '').replace(/[^\d.+-]/g, ''))
  const height = Number(String(svg.getAttribute('height') ?? '').replace(/[^\d.+-]/g, ''))
  if (Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0) {
    return { x: 0, y: 0, width, height }
  }
  return null
}

export function normalizeCadSvgForImport(svgContent: string): {
  svgContent: string
  width: number
  height: number
  displayScale: number
  warnings: string[]
} {
  const parser = new DOMParser()
  const doc = parser.parseFromString(svgContent, 'image/svg+xml')
  const svg = doc.documentElement as unknown as SVGSVGElement

  const viewBox = parseViewBox(svg)
  if (!viewBox) {
    return {
      svgContent,
      width: 1,
      height: 1,
      displayScale: 1,
      warnings: ['CAD SVG had no usable viewBox; import dimensions defaulted to 1 x 1.'],
    }
  }

  const longEdge = Math.max(viewBox.width, viewBox.height)
  const scale = longEdge < MIN_LONG_EDGE_PX ? TARGET_LONG_EDGE_PX / longEdge : 1
  const width = Math.max(1, viewBox.width * scale)
  const height = Math.max(1, viewBox.height * scale)

  const outerSvg = doc.createElementNS('http://www.w3.org/2000/svg', 'svg') as unknown as SVGSVGElement
  outerSvg.setAttribute('xmlns', 'http://www.w3.org/2000/svg')
  outerSvg.setAttribute('viewBox', `0 0 ${width} ${height}`)
  outerSvg.setAttribute('width', String(width))
  outerSvg.setAttribute('height', String(height))
  outerSvg.setAttribute('preserveAspectRatio', 'xMinYMin meet')

  svg.setAttribute('x', '0')
  svg.setAttribute('y', '0')
  svg.setAttribute('width', String(width))
  svg.setAttribute('height', String(height))
  svg.setAttribute('preserveAspectRatio', 'xMinYMin meet')
  outerSvg.appendChild(svg)

  return {
    svgContent: new XMLSerializer().serializeToString(outerSvg),
    width,
    height,
    displayScale: scale,
    warnings: scale !== 1 ? [`CAD SVG normalized to ${Math.round(width)} x ${Math.round(height)} px for import previews.`] : [],
  }
}

function metersPerCadUnit(insunits: unknown): number | null {
  const code = Number(insunits)
  if (!Number.isFinite(code)) return null
  switch (code) {
    case 1: return 0.0254
    case 2: return 0.3048
    case 3: return 1609.344
    case 4: return 0.001
    case 5: return 0.01
    case 6: return 1
    case 7: return 1000
    case 8: return 0.0000254
    case 9: return 0.0000000254
    case 10: return 0.9144
    case 11: return 0.0000000001
    case 12: return 0.000000001
    case 13: return 0.000001
    case 14: return 0.1
    case 15: return 10
    case 16: return 100
    case 17: return 1000000000
    case 18: return 149597870700
    case 19: return 9.4607304725808e15
    case 20: return 3.085677581491367e16
    default: return null
  }
}

function getCadMetersPerPixel(metadata: unknown, displayScale: number, normalizedSize: { width: number; height: number }): number | null {
  const header = metadata && typeof metadata === 'object' ? (metadata as { insunits?: unknown }) : null
  let unitMeters = metersPerCadUnit(header?.insunits)
  if (!unitMeters || displayScale <= 0) return null
  const rawLongEdge = Math.max(normalizedSize.width, normalizedSize.height) / displayScale
  const interpretedLongEdgeMeters = rawLongEdge * unitMeters
  const unitCode = Number(header?.insunits)
  if (
    (unitCode === 1 || unitCode === 2) &&
    rawLongEdge >= 5 &&
    rawLongEdge <= 200 &&
    interpretedLongEdgeMeters < 5
  ) {
    unitMeters = 1
  }
  return unitMeters / displayScale
}

function buildCadScaleReference(
  width: number,
  height: number,
  metersPerPixel: number | null,
): { p1: { x: number; y: number }; p2: { x: number; y: number }; meters: number } | undefined {
  if (!metersPerPixel || width <= 0 || height <= 0) return undefined
  const p1 = { x: width * 0.25, y: height * 0.5 }
  const p2 = { x: width * 0.75, y: height * 0.5 }
  const meters = Math.abs(p2.x - p1.x) * metersPerPixel
  if (!Number.isFinite(meters) || meters <= 0) return undefined
  return {
    p1,
    p2,
    meters: Number(meters.toPrecision(6)),
  }
}

function normalizeCadMetadata(raw: unknown): CadMetadataHeader {
  if (!raw || typeof raw !== 'object') return {}
  const value = raw as Record<string, unknown>
  return {
    insunits: value.insunits,
    measurement: value.measurement,
    extmin: value.extmin as CadMetadataHeader['extmin'],
    extmax: value.extmax as CadMetadataHeader['extmax'],
  }
}

export async function parseCadFile(
  file: File,
  kind: 'dxf' | 'dwg',
  options?: { cadImportSessionId?: string },
): Promise<CadParseResult> {
  const formData = new FormData()
  formData.append('file', file, file.name || `upload.${kind}`)

  const response = await fetchAppServerApi(
    kind === 'dwg' ? APP_SERVER_API_PATHS.convertDwg : APP_SERVER_API_PATHS.convertDxf,
    {
      method: 'POST',
      body: formData,
    },
  )
  const payload = await response.json().catch(() => null)
  if (!response.ok) {
    const message = payload?.error?.message ?? `HTTP ${response.status}`
    throw new Error(String(message))
  }

  const views: CadServerView[] = Array.isArray(payload?.views)
    ? payload.views.filter(
        (view: unknown): view is CadServerView =>
          !!view && typeof (view as CadServerView).svgContent === 'string' && (view as CadServerView).svgContent.length > 0,
      )
    : []
  if (views.length === 0) {
    const rawSvgContent = typeof payload?.svgContent === 'string' ? payload.svgContent : ''
    if (rawSvgContent) views.push({ svgContent: rawSvgContent })
  }
  if (views.length === 0) {
    throw new Error(`${kind.toUpperCase()} conversion returned no SVG content.`)
  }

  const cadMetadata = normalizeCadMetadata(payload?.cadMetadata)
  const warnings: string[] = Array.isArray(payload.warnings)
    ? payload.warnings.map((warning: unknown) => String(warning))
    : []
  const cadImportSessionId = options?.cadImportSessionId ?? crypto.randomUUID()
  const pages: PdfImportPageCandidate[] = []
  const cadImportPipelinesByPage: Record<number, CadImportPipelineContext> = {}

  views.forEach((view, pageIndex) => {
    const rawSvgContent = view.svgContent
    if (rawSvgContent.length > MAX_VECTOR_SVG_LENGTH) {
      throw new Error(`${kind.toUpperCase()} SVG payload too large (${Math.round(rawSvgContent.length / 1024)} KB).`)
    }
    const normalized = normalizeCadSvgForImport(rawSvgContent)
    const pageWarnings = [...warnings, ...normalized.warnings]
    const cadLayers: CadLayerInfo[] = parseCadLayerList(view.layers)
    const initiallyHidden = new Set(cadLayers.filter((layer) => !layer.visible).map((layer) => layer.name))
    const svgContent = filterCadSvgLayers(normalized.svgContent, initiallyHidden)
    const previewDataUrl = svgContentToDataUrl(svgContent)
    const scaleMetersPerPixel = getCadMetersPerPixel(cadMetadata, normalized.displayScale, normalized)
    const scaleReference = buildCadScaleReference(
      normalized.width,
      normalized.height,
      scaleMetersPerPixel,
    )
    const pipeline = buildCadImportPipelineContext({
      sourceKind: kind,
      sourceFileName: file.name || `upload.${kind}`,
      rawSvgContent,
      normalizedWidth: normalized.width,
      normalizedHeight: normalized.height,
      displayScale: normalized.displayScale,
      cadMetadata,
      cadImportSessionId,
      fileSizeBytes: file.size,
    })
    if (pipeline) cadImportPipelinesByPage[pageIndex] = pipeline
    pages.push({
      pageIndex,
      pageCount: views.length,
      ...(view.label ? { label: view.label } : {}),
      width: normalized.width,
      height: normalized.height,
      previewDataUrl,
      rasterDataUrl: previewDataUrl,
      vectorSvg: svgContent,
      warnings: pageWarnings,
      scaleReference,
      scaleMetersPerPixel: scaleMetersPerPixel ?? undefined,
      ...(cadLayers.length > 0 ? { cadLayers, cadSourceSvg: normalized.svgContent } : {}),
    })
  })

  return {
    fileName: file.name,
    pages,
    warnings: pages[0]?.warnings ?? warnings,
    cadImportPipeline: cadImportPipelinesByPage[0],
    cadImportPipelinesByPage,
  }
}

export async function parseSvgFile(file: File): Promise<{
  fileName: string
  pages: PdfImportPageCandidate[]
  warnings: string[]
}> {
  const rawSvgContent = await file.text()
  if (!/<svg[\s>]/i.test(rawSvgContent)) {
    throw new Error('SVG file did not contain an <svg> root.')
  }
  if (rawSvgContent.length > MAX_VECTOR_SVG_LENGTH) {
    throw new Error(`SVG payload too large (${Math.round(rawSvgContent.length / 1024)} KB).`)
  }

  const normalized = normalizeCadSvgForImport(rawSvgContent)
  const svgContent = normalized.svgContent
  const previewDataUrl = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svgContent)}`

  return {
    fileName: file.name,
    pages: [
      {
        pageIndex: 0,
        pageCount: 1,
        width: normalized.width,
        height: normalized.height,
        previewDataUrl,
        rasterDataUrl: previewDataUrl,
        vectorSvg: svgContent,
        warnings: normalized.warnings,
      },
    ],
    warnings: normalized.warnings,
  }
}

export function parseDxfFile(file: File, options?: { cadImportSessionId?: string }) {
  return parseCadFile(file, 'dxf', options)
}

export function parseDwgFile(file: File, options?: { cadImportSessionId?: string }) {
  return parseCadFile(file, 'dwg', options)
}
