import type { WireSegment } from '@/types/schema'

export type ConverterSide = 'top' | 'right' | 'bottom' | 'left'
export type ConverterCorner = 'top-left' | 'top-right' | 'bottom-right' | 'bottom-left'
export type ConverterDomain = 'AC' | 'DC'

export interface ConverterConnectionDomains {
  top?: ConverterDomain
  right?: ConverterDomain
  bottom?: ConverterDomain
  left?: ConverterDomain
}

export interface ConverterArtworkLayout {
  diagonal: 'bottom-left-to-top-right' | 'top-left-to-bottom-right'
  domainCorners: Partial<Record<ConverterDomain, ConverterCorner>>
}

export const CONVERTER_ARTWORK_PATHS = {
  base: '/symbols/energy-conversion/converter_base.svg',
  diagonal: '/symbols/energy-conversion/converter_diagonal.svg',
  AC: '/symbols/energy-conversion/symbol_AC.svg',
  DC: '/symbols/energy-conversion/symbol_DC.svg',
} as const

/** Relative size of the AC/DC artwork inside the 20-unit converter symbol. */
export const CONVERTER_DOMAIN_ICON_SIZE_RATIO = 9 / 20

/** Physical corners for the separate grid/load supply inverter, without catalog mirroring. */
export function getSeparateSupplyInverterArtworkLayout(
  dcSide: 'left' | 'right'
): ConverterArtworkLayout {
  return dcSide === 'left'
    ? {
        diagonal: 'bottom-left-to-top-right',
        domainCorners: { DC: 'top-left', AC: 'bottom-right' },
      }
    : {
        diagonal: 'top-left-to-bottom-right',
        domainCorners: { DC: 'top-right', AC: 'bottom-left' },
      }
}

/** Outside opposite corners, clear of the horizontal and vertical connection wires. */
export function getSeparateSupplyInverterDomainMarkers(
  width: number,
  height: number,
  dcSide: 'left' | 'right'
) {
  const dcSign = dcSide === 'left' ? -1 : 1
  return {
    DC: { x: dcSign * (width / 2 + 3.5), y: -height / 2 - 3 },
    AC: { x: -dcSign * (width / 2 + 3.5), y: height / 2 + 5 },
  }
}

export function isDirectionalConverterSymbol(symbolId: string | undefined): boolean {
  return symbolId === 'rectifier' || symbolId === 'inverter'
}

function cornerSides(corner: ConverterCorner): readonly ConverterSide[] {
  switch (corner) {
    case 'top-left':
      return ['top', 'left']
    case 'top-right':
      return ['top', 'right']
    case 'bottom-right':
      return ['bottom', 'right']
    case 'bottom-left':
      return ['bottom', 'left']
  }
}

function scoreCorner(
  corner: ConverterCorner,
  domain: ConverterDomain,
  connections: ConverterConnectionDomains
): number {
  // One-wire renderers mirror the final X coordinate in
  // getConverterCornerPosition. Score the physical corner after that mirror
  // so horizontal AC/DC connections keep their marks on the connected side.
  const physicalCorner: ConverterCorner = corner.endsWith('left')
    ? corner.startsWith('top')
      ? 'top-right'
      : 'bottom-right'
    : corner.startsWith('top')
      ? 'top-left'
      : 'bottom-left'
  return cornerSides(physicalCorner).reduce(
    (score, side) => score + (connections[side] === domain ? 1 : 0),
    0
  )
}

function scoreAssignment(
  firstCorner: ConverterCorner,
  secondCorner: ConverterCorner,
  domains: readonly ConverterDomain[],
  connections: ConverterConnectionDomains
): { score: number; assignment: Partial<Record<ConverterDomain, ConverterCorner>> } {
  const firstDomain = domains[0]!
  const secondDomain = domains[1]!
  if (firstDomain === secondDomain) {
    return {
      score: scoreCorner(firstCorner, firstDomain, connections),
      assignment: { [firstDomain]: firstCorner },
    }
  }

  const firstFirstScore =
    scoreCorner(firstCorner, firstDomain, connections) +
    scoreCorner(secondCorner, secondDomain, connections)
  const secondFirstScore =
    scoreCorner(firstCorner, secondDomain, connections) +
    scoreCorner(secondCorner, firstDomain, connections)
  if (secondFirstScore > firstFirstScore) {
    return {
      score: secondFirstScore,
      assignment: { [firstDomain]: secondCorner, [secondDomain]: firstCorner },
    }
  }
  return {
    score: firstFirstScore,
    assignment: { [firstDomain]: firstCorner, [secondDomain]: secondCorner },
  }
}

/**
 * Pick the diagonal and the two domain corners from the sides actually carrying
 * converter wires. Ties intentionally keep the established bottom-left →
 * top-right diagonal.
 */
export function getConverterArtworkLayout(
  inputDomain: ConverterDomain,
  outputDomain: ConverterDomain,
  connections: ConverterConnectionDomains = {}
): ConverterArtworkLayout {
  const domains = [inputDomain, outputDomain] as const
  // A vertical run has no left/right information. Use one canonical visual
  // convention shared with the situation-plan symbol: the input is on the
  // left/top corner and the output is on the right/bottom corner. The important
  // detail here is that only the X side changes between the two earlier
  // renderer implementations; the domain direction itself does not.
  if (
    connections.top &&
    connections.bottom &&
    !connections.left &&
    !connections.right &&
    inputDomain !== outputDomain
  ) {
    if (connections.top === inputDomain && connections.bottom === outputDomain) {
      return {
        diagonal: 'top-left-to-bottom-right',
        domainCorners: { [inputDomain]: 'top-left', [outputDomain]: 'bottom-right' },
      }
    }
    if (connections.bottom === inputDomain && connections.top === outputDomain) {
      return {
        diagonal: 'bottom-left-to-top-right',
        domainCorners: { [inputDomain]: 'bottom-left', [outputDomain]: 'top-right' },
      }
    }
  }
  const preferred = scoreAssignment('bottom-left', 'top-right', domains, connections)
  const mirrored = scoreAssignment('top-left', 'bottom-right', domains, connections)
  if (mirrored.score > preferred.score) {
    return {
      diagonal: 'top-left-to-bottom-right',
      domainCorners: mirrored.assignment,
    }
  }
  return {
    diagonal: 'bottom-left-to-top-right',
    domainCorners: preferred.assignment,
  }
}

/**
 * Read the domain carried by each side of a one-wire converter. Wire endpoints
 * are inset from the symbol, so geometry is used in addition to element refs.
 */
export function getConverterConnectionDomains(
  segments: readonly WireSegment[],
  deviceId: string,
  position: { x: number; y: number },
  symbolSize = 20
): ConverterConnectionDomains {
  const result: ConverterConnectionDomains = {}
  const maxNearDistance = symbolSize / 2 + 14
  const attachedSegments = segments.filter(
    (segment) => segment.fromElementId === deviceId || segment.toElementId === deviceId
  )

  // Prefer electrical ownership. Nearby trunk wires or sibling output rows
  // can lie inside the symbol's search radius without connecting to it.
  // Geometry remains a fallback for renderers without endpoint references.
  for (const segment of attachedSegments.length > 0 ? attachedSegments : segments) {
    const startDistance = Math.hypot(
      segment.startPoint.x - position.x,
      segment.startPoint.y - position.y
    )
    const endDistance = Math.hypot(segment.endPoint.x - position.x, segment.endPoint.y - position.y)
    const nearIsStart = startDistance <= endDistance
    const near = nearIsStart ? segment.startPoint : segment.endPoint
    const far = nearIsStart ? segment.endPoint : segment.startPoint
    const hasDeviceRef = segment.fromElementId === deviceId || segment.toElementId === deviceId
    if (!hasDeviceRef && Math.min(startDistance, endDistance) > maxNearDistance) continue

    const dx = far.x - near.x
    const dy = far.y - near.y
    if (Math.abs(dx) < 1 && Math.abs(dy) < 1) continue
    let side: ConverterSide
    if (Math.abs(dx) >= Math.abs(dy)) {
      side = dx < 0 ? 'left' : 'right'
    } else {
      side = dy < 0 ? 'top' : 'bottom'
    }
    result[side] = segment.domain === 'DC' ? 'DC' : 'AC'
  }
  return result
}

/** Supply-assembly convention used by the panel grid and detached supply markers. */
export const SUPPLY_ASSEMBLY_CONNECTION_DOMAINS: ConverterConnectionDomains = {
  left: 'AC',
  bottom: 'AC',
  top: 'DC',
  right: 'DC',
}

export function getConverterCornerPosition(
  corner: ConverterCorner,
  width: number,
  height: number,
  margin: number,
  iconWidth = 0,
  iconHeight = iconWidth,
  mirrorX = true
): { x: number; y: number } {
  const leftX = -width / 2 + margin + iconWidth / 2
  const rightX = width / 2 - margin - iconWidth / 2
  return {
    // The one-wire artwork uses the mirrored horizontal convention of the
    // catalog/situation-plan artwork. Keep the corner semantics intact and
    // swap only the final X coordinate.
    x: (corner.endsWith('left') ? leftX : rightX) * (mirrorX ? -1 : 1),
    y: corner.startsWith('top')
      ? -height / 2 + margin + iconHeight / 2
      : height / 2 - margin - iconHeight / 2,
  }
}

/** Canonical artwork used when no surrounding wire geometry is available. */
export function getCanonicalConverterArtworkLayout(
  inputDomain: ConverterDomain,
  outputDomain: ConverterDomain
): ConverterArtworkLayout {
  return {
    diagonal: 'bottom-left-to-top-right',
    // Keep the established catalog orientation: the output domain is at the
    // top-left and the input domain is at the bottom-right. This is the
    // no-wire fallback used by the Situation Plan.
    domainCorners: { [inputDomain]: 'bottom-right', [outputDomain]: 'top-left' },
  }
}

export function getConverterDomainCorner(
  layout: ConverterArtworkLayout,
  domain: ConverterDomain
): ConverterCorner | undefined {
  return layout.domainCorners[domain]
}

export function getConverterArtworkCatalogPaths(): readonly string[] {
  return Object.values(CONVERTER_ARTWORK_PATHS)
}
