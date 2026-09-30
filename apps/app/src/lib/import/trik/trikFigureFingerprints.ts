import type { PlanGraphicElement, PlanGraphicElementKind, Point2 } from '@/types/schema'
import { generateId } from '@/utils/project'

/** SHA-256 hex digest of decoded {@link ImageAsBase64} bytes from TRiK {@code <Figuur>}. */
export type TrikFigureFingerprint = string

export type TrikFigureFingerprintMatch = {
  assetId: string
  kind: PlanGraphicElementKind
}

/** TRiK blocks represented as our rectangle graphic (cupboards, kitchen sink, etc.). */
export const TRIK_RECTANGLE_GRAPHIC_MATCH: TrikFigureFingerprintMatch = {
  assetId: 'rectangle-basic',
  kind: 'rectangle',
}

/**
 * Known TRiK figure image fingerprints → Eendra plan graphic assets.
 * Add entries with `node apps/app/scripts/extract-trik-fingerprints.mjs <sample.trik>`.
 */
export const TRIK_FIGURE_FINGERPRINT_REGISTRY: Record<
  TrikFigureFingerprint,
  TrikFigureFingerprintMatch
> = {
  // badkuipen.trik — TRiK bathtub symbol (all rotations share the same embedded PNG)
  '5b24890d468905ee389d00e734b92e4482454d03e3de724f2d608000a50bf2d3': {
    assetId: 'bathtub-basic',
    kind: 'bathtub',
  },
  // douches.trik — shower symbols (two TRiK variants, same asset)
  'bf815e228088fec853390462468b099ea27a9d8f6d5a0c8e2ca1c8cbddef2d93': {
    assetId: 'shower-basic',
    kind: 'shower',
  },
  '05801edc6227bc4deb4eb541b8a20074f99ee405b4b128b841072fc1cdd52758': {
    assetId: 'shower-basic',
    kind: 'shower',
  },
  // toiletten.trik
  '8e05014fdc9521b3cdebda97a6280bd9e7547313e20e03bc9af3263312bda9b4': {
    assetId: 'toilet-basic',
    kind: 'toilet',
  },
  '47c3b8fec0711ffe68717a9a72e74416d4e6dfecbb6f484b3ec2a4b92dc300d4': {
    assetId: 'toilet-basic',
    kind: 'toilet',
  },
  // washbasins.trik
  '8c6294a6b9df9aa98e35641ac6eab1f04b026e5b148c69506c5890f33429330c': {
    assetId: 'washbasin-basic',
    kind: 'washbasin',
  },
  '63263a90e2577f9688cb0ae7bd2ce2580062fe5365b2906c5226b0f4d15b309d': {
    assetId: 'washbasin-basic',
    kind: 'washbasin',
  },
  // car.trik
  'f09033053e391db7d266f00f23199787ba5549d53dc313ffa1227459fbd13080': {
    assetId: 'car-basic',
    kind: 'car',
  },
  // kitchensink.trik — TRiK kitchen sink figure → rectangle placeholder
  '4022db11be94f0233764ba493ea97a9f4f57291e9de044e9671867b38d21db50': TRIK_RECTANGLE_GRAPHIC_MATCH,
}

/** @deprecated Use {@link TRIK_RECTANGLE_GRAPHIC_MATCH}. */
export const TRIK_CABINET_RECTANGLE_MATCH = TRIK_RECTANGLE_GRAPHIC_MATCH

export type TrikVectorRectPlacementInput = {
  width: number
  height: number
  center: Point2
  rotationDeg: number
  fillType?: string
}

/**
 * Outline-only {@code Rechthoek} elements ({@code VullingType="Geen"}) are decorative vectors
 * composited into the imported raster. Filled/default rects become plan graphic rectangles.
 */
export function isTrikCabinetRectangle(rect: TrikVectorRectPlacementInput): boolean {
  const fill = (rect.fillType ?? '').trim().toLowerCase()
  return fill !== 'geen'
}

export function partitionTrikVectorRects<T extends TrikVectorRectPlacementInput>(
  rects: T[],
): { graphic: T[]; decorative: T[] } {
  const graphic: T[] = []
  const decorative: T[] = []
  for (const rect of rects) {
    if (isTrikCabinetRectangle(rect)) {
      graphic.push(rect)
    } else {
      decorative.push(rect)
    }
  }
  return { graphic, decorative }
}

export async function computeTrikFigureFingerprint(
  imageAsBase64: string,
): Promise<TrikFigureFingerprint | undefined> {
  const trimmed = imageAsBase64.trim()
  if (!trimmed) return undefined
  try {
    const binary = atob(trimmed)
    const bytes = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i += 1) {
      bytes[i] = binary.charCodeAt(i)
    }
    const digest = await crypto.subtle.digest('SHA-256', bytes)
    const arr = new Uint8Array(digest)
    return Array.from(arr)
      .map((byte) => byte.toString(16).padStart(2, '0'))
      .join('')
  } catch {
    return undefined
  }
}

export async function matchTrikFigureFingerprint(
  imageAsBase64: string,
): Promise<TrikFigureFingerprintMatch | undefined> {
  const fingerprint = await computeTrikFigureFingerprint(imageAsBase64)
  if (!fingerprint) return undefined
  return TRIK_FIGURE_FINGERPRINT_REGISTRY[fingerprint]
}

export type TrikFigurePlacementInput = {
  width: number
  height: number
  center: Point2
  rotationDeg: number
  imageAsBase64: string
}

export type TrikFigurePlacementScaled = {
  widthPx: number
  heightPx: number
  center: Point2
  rotationDeg: number
}

export function scaleTrikFigurePlacement(
  figure: TrikFigurePlacementInput,
  scale: number,
): TrikFigurePlacementScaled {
  return {
    widthPx: figure.width * scale,
    heightPx: figure.height * scale,
    center: { x: figure.center.x * scale, y: figure.center.y * scale },
    rotationDeg: figure.rotationDeg,
  }
}

/** Eendra SVG orientation vs TRiK embedded figure art (degrees added to TRiK Hoek). */
const TRIK_IMPORT_ROTATION_OFFSET_DEG: Partial<Record<PlanGraphicElementKind, number>> = {
  car: 180,
  washbasin: 180,
}

export function applyTrikImportRotationOffset(
  rotationDeg: number,
  kind: PlanGraphicElementKind,
): number {
  return rotationDeg + (TRIK_IMPORT_ROTATION_OFFSET_DEG[kind] ?? 0)
}

export function createPlanGraphicElementFromTrikFigure(
  floorId: string,
  scaled: TrikFigurePlacementScaled,
  match: TrikFigureFingerprintMatch,
): PlanGraphicElement {
  return {
    id: generateId(),
    floorId,
    kind: match.kind,
    assetId: match.assetId,
    pos: { ...scaled.center },
    width: scaled.widthPx,
    height: scaled.heightPx,
    rotationDeg: applyTrikImportRotationOffset(scaled.rotationDeg, match.kind),
    layer: 'floor-plan-graphics',
  }
}

export async function partitionTrikFiguresByFingerprint<T extends TrikFigurePlacementInput>(
  figures: T[],
): Promise<{
  recognized: Array<{ figure: T; match: TrikFigureFingerprintMatch }>
  unrecognized: T[]
}> {
  const recognized: Array<{ figure: T; match: TrikFigureFingerprintMatch }> = []
  const unrecognized: T[] = []
  for (const figure of figures) {
    const match = await matchTrikFigureFingerprint(figure.imageAsBase64)
    if (match) {
      recognized.push({ figure, match })
    } else {
      unrecognized.push(figure)
    }
  }
  return { recognized, unrecognized }
}
