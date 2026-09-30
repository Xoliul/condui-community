import type {
  CadPoint3,
  CadReferenceCropRect,
  CadReferenceExtents,
  CadReferenceV1,
} from '@/types/schema'
import {
  applyAffine,
  invertAffine,
  isFiniteAffine,
  legacyLibreDwgToAffine,
  parseOuterCadToSvgMatrix,
  type Affine2D,
  type LegacyLibreDwgToSvg,
} from './svgAffineMatrix'
import { planImageLocalToScenePoint, scenePointToPlanImageLocal } from './planImageRotation'
export interface CadMetadataHeader {
  insunits?: unknown
  measurement?: unknown
  extmin?: Partial<CadPoint3> | null
  extmax?: Partial<CadPoint3> | null
}
export interface SvgViewBox {
  x: number
  y: number
  width: number
  height: number
}
export type LibreDwgToSvgTransform = LegacyLibreDwgToSvg
export interface SvgNormalizationTransform {
  scale: number
  translateX: number
  translateY: number
}
export interface ResolvedCadUnits {
  insunitsRaw: number | null
  insunitsResolved: number
  metersPerCadUnit: number
  unitResolutionNote?: string
}
const EXTREME_EXTENT = 1e15
function finiteNumber(value: unknown): number | null {
  const num = Number(value)
  return Number.isFinite(num) ? num : null
}
function isUsableExtentPoint(point: Partial<CadPoint3> | null | undefined): point is CadPoint3 {
  if (!point) return false
  const x = finiteNumber(point.x)
  const y = finiteNumber(point.y)
  if (x == null || y == null) return false
  return Math.abs(x) < EXTREME_EXTENT && Math.abs(y) < EXTREME_EXTENT
}
export function metersPerCadUnitFromInsunits(insunits: unknown): number | null {
  const code = finiteNumber(insunits)
  if (code == null) return null
  switch (code) {
    case 1:
      return 0.0254
    case 2:
      return 0.3048
    case 3:
      return 1609.344
    case 4:
      return 0.001
    case 5:
      return 0.01
    case 6:
      return 1
    case 7:
      return 1000
    case 8:
      return 0.0000254
    case 9:
      return 0.0000000254
    case 10:
      return 0.9144
    case 11:
      return 0.0000000001
    case 12:
      return 0.000000001
    case 13:
      return 0.000001
    case 14:
      return 0.1
    case 15:
      return 10
    case 16:
      return 100
    case 17:
      return 1000000000
    case 18:
      return 149597870700
    case 19:
      return 9.4607304725808e15
    case 20:
      return 3.085677581491367e16
    default:
      return null
  }
}
export function resolveCadUnits(
  metadata: CadMetadataHeader | null | undefined,
  displayScale: number,
  uncroppedAssetSize: { width: number; height: number }
): ResolvedCadUnits {
  const insunitsRaw = finiteNumber(metadata?.insunits)
  let unitMeters = metersPerCadUnitFromInsunits(insunitsRaw)
  let insunitsResolved = insunitsRaw ?? 6
  let unitResolutionNote: string | undefined
  if (!unitMeters || displayScale <= 0) {
    unitMeters = 1
    insunitsResolved = 6
    unitResolutionNote = 'INSUNITS missing or unsupported; defaulting to metres.'
  } else {
    const rawLongEdge = Math.max(uncroppedAssetSize.width, uncroppedAssetSize.height) / displayScale
    const interpretedLongEdgeMeters = rawLongEdge * unitMeters
    if (
      (insunitsRaw === 1 || insunitsRaw === 2) &&
      rawLongEdge >= 5 &&
      rawLongEdge <= 200 &&
      interpretedLongEdgeMeters < 5
    ) {
      unitMeters = 1
      insunitsResolved = 6
      unitResolutionNote = 'Inch/foot INSUNITS overridden by metric heuristic.'
    }
  }
  return {
    insunitsRaw,
    insunitsResolved,
    metersPerCadUnit: unitMeters,
    unitResolutionNote,
  }
}
export function parseSvgViewBox(svgContent: string): SvgViewBox | null {
  const viewBoxMatch = svgContent.match(/viewBox=["']([^"']+)["']/i)
  if (viewBoxMatch?.[1]) {
    const parts = viewBoxMatch[1]
      .split(/[\s,]+/)
      .map(Number)
      .filter(Number.isFinite)
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
  const widthMatch = svgContent.match(/\bwidth=["']([^"']+)["']/i)
  const heightMatch = svgContent.match(/\bheight=["']([^"']+)["']/i)
  const width = widthMatch ? finiteNumber(String(widthMatch[1]).replace(/[^\d.+-]/g, '')) : null
  const height = heightMatch ? finiteNumber(String(heightMatch[1]).replace(/[^\d.+-]/g, '')) : null
  if (width != null && height != null && width > 0 && height > 0) {
    return { x: 0, y: 0, width, height }
  }
  return null
}
/** @deprecated Use parseOuterCadToSvgMatrix instead. */
export function parseLibreDwgToSvgTransform(svgContent: string): LibreDwgToSvgTransform {
  const matrix = parseOuterCadToSvgMatrix(svgContent)
  return {
    translateX: matrix.e,
    translateY: matrix.f,
    scale: Math.max(Math.abs(matrix.a), Math.abs(matrix.d), 1e-9),
    flipY: matrix.d < 0,
  }
}

function affineBounds(
  matrix: Affine2D,
  extents: CadReferenceExtents
): { minX: number; minY: number; maxX: number; maxY: number } {
  const points = [
    applyAffine(matrix, extents.min),
    applyAffine(matrix, { x: extents.max.x, y: extents.min.y }),
    applyAffine(matrix, { x: extents.min.x, y: extents.max.y }),
    applyAffine(matrix, extents.max),
  ]
  const xs = points.map((point) => point.x)
  const ys = points.map((point) => point.y)
  return {
    minX: Math.min(...xs),
    minY: Math.min(...ys),
    maxX: Math.max(...xs),
    maxY: Math.max(...ys),
  }
}

function viewBoxDistance(
  matrix: Affine2D,
  extents: CadReferenceExtents,
  viewBox: SvgViewBox
): number {
  const bounds = affineBounds(matrix, extents)
  return (
    Math.abs(bounds.minX - viewBox.x) +
    Math.abs(bounds.minY - viewBox.y) +
    Math.abs(bounds.maxX - (viewBox.x + viewBox.width)) +
    Math.abs(bounds.maxY - (viewBox.y + viewBox.height))
  )
}

function repairLegacyTransformListOrder(
  matrix: Affine2D,
  cadReference: CadReferenceV1
): Affine2D {
  const extents = cadReference.fullSourceExtents
  const viewBox = cadReference.rawViewBox
  if (!extents || !viewBox) return matrix

  // Imports made before SVG transform-list composition was corrected stored
  // T×A instead of A×T. Recover the equivalent translation and retain it only
  // when the known CAD extents map materially closer to the stored SVG box.
  const candidate = {
    ...matrix,
    e: matrix.a * matrix.e + matrix.c * matrix.f,
    f: matrix.b * matrix.e + matrix.d * matrix.f,
  }
  const currentDistance = viewBoxDistance(matrix, extents, viewBox)
  const candidateDistance = viewBoxDistance(candidate, extents, viewBox)
  const translationRepair = candidateDistance + 1e-6 < currentDistance ? candidate : matrix
  const translationRepairDistance = Math.min(currentDistance, candidateDistance)

  // A short-lived parser selected the first transformed group inside <defs>
  // instead of LibreDWG's rendered model-space group. Recover axis-aligned
  // drawings from their authoritative CAD extents and SVG viewBox. Prefer the
  // normal CAD X direction and use the persisted Y-axis convention.
  const modelWidth = extents.max.x - extents.min.x
  const modelHeight = extents.max.y - extents.min.y
  if (modelWidth <= 0 || modelHeight <= 0) return translationRepair
  const looksLikeNestedBlockTransform =
    Math.abs(matrix.b) < 1e-12 &&
    Math.abs(matrix.c) < 1e-12 &&
    matrix.a < 0 &&
    cadReference.yAxisUp &&
    matrix.d > 0
  if (!looksLikeNestedBlockTransform) return translationRepair
  const scaleX = viewBox.width / modelWidth
  const scaleY = viewBox.height / modelHeight
  if (!Number.isFinite(scaleX) || !Number.isFinite(scaleY) || scaleX <= 0 || scaleY <= 0) {
    return translationRepair
  }
  const inferredYScale = cadReference.yAxisUp ? -scaleY : scaleY
  const inferred = {
    a: scaleX,
    b: 0,
    c: 0,
    d: inferredYScale,
    e: viewBox.x - scaleX * extents.min.x,
    f:
      inferredYScale < 0
        ? viewBox.y - inferredYScale * extents.max.y
        : viewBox.y - inferredYScale * extents.min.y,
  }
  const inferredDistance = viewBoxDistance(inferred, extents, viewBox)
  return inferredDistance + 1e-6 < translationRepairDistance ? inferred : translationRepair
}

export function resolveCadToSvgMatrix(cadReference: CadReferenceV1): Affine2D {
  const stored = cadReference.cadToSvgMatrix
  if (stored && isFiniteAffine(stored)) {
    return repairLegacyTransformListOrder(stored, cadReference)
  }
  const legacy = cadReference.libreDwgToSvg as LibreDwgToSvgTransform & {
    scaleX?: number
    scaleY?: number
  }
  if (finiteNumber(legacy.scaleX) != null && finiteNumber(legacy.scaleY) != null) {
    return {
      a: legacy.scaleX ?? 1,
      b: 0,
      c: 0,
      d: legacy.scaleY ?? 1,
      e: legacy.translateX ?? 0,
      f: legacy.translateY ?? 0,
    }
  }
  return legacyLibreDwgToAffine(legacy)
}

export function resolveMetersPerCadUnit(
  cadReference: CadReferenceV1,
  calibratedPxPerMeter?: number
): number {
  if (metersPerCadUnitFromInsunits(cadReference.insunitsRaw) != null) {
    return cadReference.metersPerCadUnit
  }
  if (
    calibratedPxPerMeter == null ||
    !Number.isFinite(calibratedPxPerMeter) ||
    calibratedPxPerMeter <= 0
  ) {
    return cadReference.metersPerCadUnit
  }

  const matrix = resolveCadToSvgMatrix(cadReference)
  const svgUnitsPerCadUnit = Math.max(
    Math.hypot(matrix.a, matrix.b),
    Math.hypot(matrix.c, matrix.d)
  )
  const assetPixelsPerCadUnit = svgUnitsPerCadUnit * cadReference.svgNormalization.scale
  const calibrated = assetPixelsPerCadUnit / calibratedPxPerMeter
  return Number.isFinite(calibrated) && calibrated > 0
    ? calibrated
    : cadReference.metersPerCadUnit
}

export function normalizeCadHeaderExtents(
  metadata: CadMetadataHeader | null | undefined,
  viewBox: SvgViewBox | null
): {
  extmin: CadPoint3 | null
  extmax: CadPoint3 | null
  fullSourceExtents: CadReferenceExtents | null
} {
  const extminRaw = metadata?.extmin
  const extmaxRaw = metadata?.extmax
  if (isUsableExtentPoint(extminRaw) && isUsableExtentPoint(extmaxRaw)) {
    const min = { x: extminRaw.x, y: extminRaw.y, z: finiteNumber(extminRaw.z) ?? undefined }
    const max = { x: extmaxRaw.x, y: extmaxRaw.y, z: finiteNumber(extmaxRaw.z) ?? undefined }
    return {
      extmin: min,
      extmax: max,
      fullSourceExtents: { min, max },
    }
  }
  if (viewBox) {
    const min = { x: viewBox.x, y: viewBox.y }
    const max = { x: viewBox.x + viewBox.width, y: viewBox.y + viewBox.height }
    return {
      extmin: min,
      extmax: max,
      fullSourceExtents: { min, max },
    }
  }
  return { extmin: null, extmax: null, fullSourceExtents: null }
}
function cadToSvgUserSpace(
  cad: { x: number; y: number },
  cadToSvg: Affine2D
): { x: number; y: number } {
  return applyAffine(cadToSvg, cad)
}
function svgUserSpaceToCad(
  svg: { x: number; y: number },
  cadToSvg: Affine2D
): { x: number; y: number } {
  const inverse = invertAffine(cadToSvg)
  if (!inverse) {
    return { x: 0, y: 0 }
  }
  return applyAffine(inverse, svg)
}
function svgUserToUncroppedAssetPx(
  svg: { x: number; y: number },
  viewBox: SvgViewBox,
  normalization: SvgNormalizationTransform
): { x: number; y: number } {
  return {
    x: (svg.x - viewBox.x + normalization.translateX) * normalization.scale,
    y: (svg.y - viewBox.y + normalization.translateY) * normalization.scale,
  }
}
function uncroppedAssetPxToSvgUser(
  assetPx: { x: number; y: number },
  viewBox: SvgViewBox,
  normalization: SvgNormalizationTransform
): { x: number; y: number } {
  if (normalization.scale === 0) {
    return { x: viewBox.x, y: viewBox.y }
  }
  return {
    x: assetPx.x / normalization.scale - normalization.translateX + viewBox.x,
    y: assetPx.y / normalization.scale - normalization.translateY + viewBox.y,
  }
}
export function cadPointToUncroppedAssetPx(
  cad: { x: number; y: number },
  viewBox: SvgViewBox,
  cadToSvg: Affine2D,
  svgNormalization: SvgNormalizationTransform
): { x: number; y: number } {
  const svgUser = cadToSvgUserSpace(cad, cadToSvg)
  return svgUserToUncroppedAssetPx(svgUser, viewBox, svgNormalization)
}
export function uncroppedAssetPxToCadPoint(
  assetPx: { x: number; y: number },
  viewBox: SvgViewBox,
  cadToSvg: Affine2D,
  svgNormalization: SvgNormalizationTransform
): { x: number; y: number } {
  const svgUser = uncroppedAssetPxToSvgUser(assetPx, viewBox, svgNormalization)
  return svgUserSpaceToCad(svgUser, cadToSvg)
}
export function scenePointToUncroppedAssetPx(
  scene: { x: number; y: number },
  cropInAssetSpace: CadReferenceCropRect,
  planImageOffset: { x: number; y: number },
  planImageRotationDeg = 0
): { x: number; y: number } {
  const local = scenePointToPlanImageLocal(scene, planImageOffset, planImageRotationDeg)
  return {
    x: local.x + cropInAssetSpace.x,
    y: local.y + cropInAssetSpace.y,
  }
}
export function uncroppedAssetPxToScenePoint(
  assetPx: { x: number; y: number },
  cropInAssetSpace: CadReferenceCropRect,
  planImageOffset: { x: number; y: number },
  planImageRotationDeg = 0
): { x: number; y: number } {
  return planImageLocalToScenePoint(
    { x: assetPx.x - cropInAssetSpace.x, y: assetPx.y - cropInAssetSpace.y },
    planImageOffset,
    planImageRotationDeg
  )
}
/** @deprecated Use scenePointToUncroppedAssetPx with planImageOffset. */
export function sitplanPointToUncroppedAssetPx(
  sitplan: { x: number; y: number },
  cropInAssetSpace: CadReferenceCropRect
): { x: number; y: number } {
  return {
    x: sitplan.x + cropInAssetSpace.x,
    y: sitplan.y + cropInAssetSpace.y,
  }
}
export function scenePointToCadPoint(
  scene: { x: number; y: number },
  cadReference: CadReferenceV1,
  rawViewBox: SvgViewBox,
  planImageOffset: { x: number; y: number },
  planImageRotationDeg = 0
): { x: number; y: number } {
  const uncropped = scenePointToUncroppedAssetPx(
    scene,
    cadReference.cropInAssetSpace,
    planImageOffset,
    planImageRotationDeg
  )
  return uncroppedAssetPxToCadPoint(
    uncropped,
    rawViewBox,
    resolveCadToSvgMatrix(cadReference),
    cadReference.svgNormalization
  )
}
export function cadPointToScenePoint(
  cad: { x: number; y: number },
  cadReference: CadReferenceV1,
  rawViewBox: SvgViewBox,
  planImageOffset: { x: number; y: number },
  planImageRotationDeg = 0
): { x: number; y: number } {
  const uncropped = cadPointToUncroppedAssetPx(
    cad,
    rawViewBox,
    resolveCadToSvgMatrix(cadReference),
    cadReference.svgNormalization
  )
  return uncroppedAssetPxToScenePoint(
    uncropped,
    cadReference.cropInAssetSpace,
    planImageOffset,
    planImageRotationDeg
  )
}
export function computeCropInModelSpace(
  cropInAssetSpace: CadReferenceCropRect,
  viewBox: SvgViewBox,
  cadToSvg: Affine2D,
  svgNormalization: SvgNormalizationTransform
): CadReferenceExtents {
  const corners = [
    { x: cropInAssetSpace.x, y: cropInAssetSpace.y },
    { x: cropInAssetSpace.x + cropInAssetSpace.width, y: cropInAssetSpace.y },
    { x: cropInAssetSpace.x, y: cropInAssetSpace.y + cropInAssetSpace.height },
    {
      x: cropInAssetSpace.x + cropInAssetSpace.width,
      y: cropInAssetSpace.y + cropInAssetSpace.height,
    },
  ]
  const cadPoints = corners.map((corner) =>
    uncroppedAssetPxToCadPoint(corner, viewBox, cadToSvg, svgNormalization)
  )
  const xs = cadPoints.map((point) => point.x)
  const ys = cadPoints.map((point) => point.y)
  return {
    min: { x: Math.min(...xs), y: Math.min(...ys) },
    max: { x: Math.max(...xs), y: Math.max(...ys) },
  }
}
export function deriveRawViewBoxFromCadReference(cadReference: CadReferenceV1): SvgViewBox {
  const { uncroppedAssetSize, svgNormalization } = cadReference
  const width = uncroppedAssetSize.width / svgNormalization.scale
  const height = uncroppedAssetSize.height / svgNormalization.scale
  const extmin = cadReference.extmin
  const extmax = cadReference.extmax
  if (extmin && extmax) {
    return {
      x: extmin.x,
      y: Math.min(extmin.y, extmax.y),
      width: Math.max(extmax.x - extmin.x, width),
      height: Math.max(Math.abs(extmax.y - extmin.y), height),
    }
  }
  return { x: 0, y: 0, width, height }
}
export function resolveCadReferenceRawViewBox(cadReference: CadReferenceV1): SvgViewBox {
  const stored = cadReference.rawViewBox
  if (
    stored &&
    Number.isFinite(stored.x) &&
    Number.isFinite(stored.y) &&
    Number.isFinite(stored.width) &&
    Number.isFinite(stored.height) &&
    stored.width > 0 &&
    stored.height > 0
  ) {
    return stored
  }
  return deriveRawViewBoxFromCadReference(cadReference)
}
export function scenePointToCadPointFromReference(
  scene: { x: number; y: number },
  cadReference: CadReferenceV1,
  planImageOffset: { x: number; y: number },
  planImageRotationDeg = 0
): { x: number; y: number } {
  if (!cadReference.cadToSvgMatrix || !cadReference.rawViewBox) {
    const uncropped = scenePointToUncroppedAssetPx(
      scene,
      cadReference.cropInAssetSpace,
      planImageOffset,
      planImageRotationDeg
    )
    const sourceExtents = cadReference.fullSourceExtents
    const sourceSize = cadReference.uncroppedAssetSize
    if (sourceExtents && sourceSize.width > 0 && sourceSize.height > 0) {
      const xRatio = uncropped.x / sourceSize.width
      const yRatio = uncropped.y / sourceSize.height
      const modelWidth = sourceExtents.max.x - sourceExtents.min.x
      const modelHeight = sourceExtents.max.y - sourceExtents.min.y
      return {
        x: sourceExtents.min.x + xRatio * modelWidth,
        y: cadReference.yAxisUp
          ? sourceExtents.max.y - yRatio * modelHeight
          : sourceExtents.min.y + yRatio * modelHeight,
      }
    }

    const crop = cadReference.cropInAssetSpace
    const model = cadReference.cropInModelSpace
    const xRatio = crop.width > 0 ? (uncropped.x - crop.x) / crop.width : 0
    const yRatio = crop.height > 0 ? (uncropped.y - crop.y) / crop.height : 0
    const modelWidth = model.max.x - model.min.x
    const modelHeight = model.max.y - model.min.y
    return {
      x: model.min.x + xRatio * modelWidth,
      y: cadReference.yAxisUp
        ? model.max.y - yRatio * modelHeight
        : model.min.y + yRatio * modelHeight,
    }
  }
  return scenePointToCadPoint(
    scene,
    cadReference,
    resolveCadReferenceRawViewBox(cadReference),
    planImageOffset,
    planImageRotationDeg
  )
}
export { parseOuterCadToSvgMatrix }
