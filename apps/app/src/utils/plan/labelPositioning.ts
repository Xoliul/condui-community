import type { Endpoint, Placement } from '@/types/schema'
import type { QuadrantScores } from '@/utils/planAutoOrient'
import type { WallObstacleRect } from '@/lib/plan/labelWallCollision'
import type {
  WireObstacleBounds,
  WireObstacleIndex,
  WireObstacleRect,
} from '@/lib/plan/labelWireCollision'
import {
  PLAN_SYMBOL_FALLBACK_PX,
  PLAN_LABEL_FONT_SIZE_AT_FALLBACK,
} from '@/constants/planConstants'
import { getPlacementWorldBounds } from '@/utils/plan/placementBounds'

export type LabelDirection = 'right' | 'left' | 'below' | 'above'

type LabelPlacement = Placement & {
  endpointId?: string
  junctionPanelLabel?: string
  /** Label of a plan-only symbol drawn like a board (a supply enclosure). */
  planLabel?: string
}

const OPPOSITE_DIR: Record<LabelDirection, LabelDirection> = {
  right: 'left',
  left: 'right',
  above: 'below',
  below: 'above',
}

let measureCanvas: HTMLCanvasElement | null = null
let measureCtx: CanvasRenderingContext2D | null = null

export function getLabelBoxSize(
  text: string,
  fontSize: number,
  fontFamily: string
): { width: number; height: number } {
  const fallback = () => {
    const approxWidth = text.length * fontSize * 0.6
    const height = fontSize * 1.1
    // Small padding so text doesn't touch the edge
    return { width: approxWidth + 2, height }
  }

  if (typeof document === 'undefined') {
    return fallback()
  }

  if (!measureCanvas) {
    measureCanvas = document.createElement('canvas')
    measureCtx = measureCanvas.getContext('2d')
  }

  if (!measureCtx) {
    return fallback()
  }

  const ctx = measureCtx
  ctx.font = `${fontSize}px ${fontFamily}`
  const metrics = ctx.measureText(text)

  const rawWidth =
    metrics.actualBoundingBoxLeft != null && metrics.actualBoundingBoxRight != null
      ? metrics.actualBoundingBoxRight + metrics.actualBoundingBoxLeft
      : metrics.width

  const ascent =
    metrics.actualBoundingBoxAscent != null ? metrics.actualBoundingBoxAscent : fontSize * 0.8
  const descent =
    metrics.actualBoundingBoxDescent != null ? metrics.actualBoundingBoxDescent : fontSize * 0.2

  const paddedWidth = rawWidth + 2
  const height = ascent + descent + 2

  return { width: paddedWidth, height }
}

function centerToBox(
  centerX: number,
  centerY: number,
  width: number,
  height: number
): { x: number; y: number; width: number; height: number } {
  return {
    x: centerX - width / 2,
    y: centerY - height / 2,
    width,
    height,
  }
}

function queryWireObstacles(
  obstacles: WireObstacleRect[] | WireObstacleIndex | null,
  bounds: WireObstacleBounds
): WireObstacleRect[] {
  if (!obstacles) return []
  if (Array.isArray(obstacles)) return obstacles
  return obstacles.query(bounds)
}

/**
 * Calculate label positions with collision detection.
 * Rules:
 * 1. No wall scores (no plan image): default to RIGHT, then try others with collision avoidance.
 * 2. Wall scores available: find the quadrant with the MOST opaque pixels (the wall).
 *    Place label on the OPPOSITE side. Still do collision avoidance.
 */
export function calculateLabelPositions(
  placements: LabelPlacement[],
  getEndpointById: (id: string) => Endpoint | null | undefined,
  wallScoresByPlacementId?: Map<string, QuadrantScores> | null,
  baseSymbolSizePx: number = PLAN_SYMBOL_FALLBACK_PX,
  fontFamily: string = 'Figtree',
  /** Vector floor-plan walls (plan space); labels avoid overlapping their painted thickness. */
  wallObstacleRects: WallObstacleRect[] | null = null,
  /** Plan wire routes (plan space); labels prefer not to overlap wires (soft constraint). */
  wireObstacleRects: WireObstacleRect[] | WireObstacleIndex | null = null
): Map<string, { x: number; y: number }> {
  const positions = new Map<string, { x: number; y: number }>()
  const labelBoxes: Array<{ id: string; x: number; y: number; width: number; height: number }> = []
  const labelGap = 2 // Positive gap so labels do not overlap symbol bounds
  const labelSpacing = 4
  const labelFontSize =
    PLAN_LABEL_FONT_SIZE_AT_FALLBACK * (baseSymbolSizePx / PLAN_SYMBOL_FALLBACK_PX)

  const placementInfoById = new Map<
    string,
    {
      endpoint: Endpoint | null | undefined
      bounds: { left: number; right: number; top: number; bottom: number } | null
    }
  >()

  placements.forEach((placement) => {
    const endpoint = placement.endpointId ? getEndpointById(placement.endpointId) : null
    if (!placement.pos) {
      placementInfoById.set(placement.id, { endpoint, bounds: null })
      return
    }
    const socketCount =
      endpoint && endpoint.socketProps && typeof endpoint.socketProps.socketCount === 'number'
        ? endpoint.socketProps.socketCount
        : 1
    const symbolType =
      endpoint?.symbol ??
      (placement.junctionPanelLabel != null
        ? 'junction_panel'
        : placement.planLabel != null
          ? 'panel_distribution'
          : undefined)
    const bounds = getPlacementWorldBounds(
      placement.pos,
      placement.rotationDeg ?? 0,
      placement.scale,
      socketCount,
      symbolType,
      baseSymbolSizePx
    )
    placementInfoById.set(placement.id, { endpoint, bounds })
  })

  placements.forEach((placement) => {
    const info = placementInfoById.get(placement.id)
    const endpoint =
      info?.endpoint ?? (placement.endpointId ? getEndpointById(placement.endpointId) : null)
    const labelText: string | undefined =
      endpoint?.label ?? placement.junctionPanelLabel ?? placement.planLabel
    if (!labelText || !placement.pos) return
    const { width: labelWidth, height: labelHeight } = getLabelBoxSize(
      labelText,
      labelFontSize,
      fontFamily
    )
    const halfLabelWidth = labelWidth / 2
    const halfLabelHeight = labelHeight / 2
    const cx = placement.pos.x
    const cy = placement.pos.y

    const isPanelLike =
      endpoint?.symbol === 'panel_distribution' ||
      placement.junctionPanelLabel != null ||
      placement.planLabel != null

    // Base distance from symbol center to label box center, per axis,
    // derived from actual symbol bounds when available.
    const bounds = info?.bounds ?? null
    const extentRight = bounds ? bounds.right - cx : (baseSymbolSizePx * placement.scale) / 2
    const extentLeft = bounds ? cx - bounds.left : (baseSymbolSizePx * placement.scale) / 2
    const extentTop = bounds ? cy - bounds.top : (baseSymbolSizePx * placement.scale) / 2
    const extentBottom = bounds ? bounds.bottom - cy : (baseSymbolSizePx * placement.scale) / 2

    // Panels/junction panels are significantly wider than tall on plan. Keep labels further
    // away horizontally so left/right placements do not sit on top of the symbol body.
    const avgHorizontalExtent = (extentLeft + extentRight) / 2
    const avgVerticalExtent = (extentTop + extentBottom) / 2
    const panelHorizontalAspectBoost = isPanelLike
      ? Math.max(0, (avgHorizontalExtent - avgVerticalExtent) * 0.9)
      : 0
    const panelExtraGapX = isPanelLike ? 12 + panelHorizontalAspectBoost : 0
    const panelExtraGapY = isPanelLike ? 6 : 0

    const offsetRight = extentRight + labelGap + panelExtraGapX + halfLabelWidth
    const offsetLeft = extentLeft + labelGap + panelExtraGapX + halfLabelWidth
    const offsetAbove = extentTop + labelGap + panelExtraGapY + halfLabelHeight
    const offsetBelow = extentBottom + labelGap + panelExtraGapY + halfLabelHeight

    // Build candidate positions grouped by direction (all positions are box centers).
    const candidatesByDir: Record<LabelDirection, Array<{ x: number; y: number }>> = {
      right: [
        { x: cx + offsetRight, y: cy },
        { x: cx + offsetRight, y: cy - halfLabelHeight },
        { x: cx + offsetRight, y: cy + halfLabelHeight },
      ],
      left: [
        { x: cx - offsetLeft, y: cy },
        { x: cx - offsetLeft, y: cy - halfLabelHeight },
        { x: cx - offsetLeft, y: cy + halfLabelHeight },
      ],
      below: [
        { x: cx, y: cy + offsetBelow },
        { x: cx - halfLabelWidth, y: cy + offsetBelow },
        { x: cx + halfLabelWidth, y: cy + offsetBelow },
      ],
      above: [
        { x: cx, y: cy - offsetAbove },
        { x: cx - halfLabelWidth, y: cy - offsetAbove },
        { x: cx + halfLabelWidth, y: cy - offsetAbove },
      ],
    }

    // Determine preferred direction order
    let dirOrder: LabelDirection[]
    const scores = wallScoresByPlacementId?.get(placement.id)
    const maxScore = scores ? Math.max(scores.top, scores.right, scores.bottom, scores.left) : 0
    // Only use wall scores when there is a real wall (opaque content); in empty/transparent
    // image areas scores can be tiny but non-zero, which would wrongly force labels to one side.
    const minWallScoreForLabel = 0.07
    if (scores && maxScore >= minWallScoreForLabel) {
      // Find the quadrant with the MOST opaque pixels — that's the wall
      const entries: Array<{ dir: LabelDirection; score: number }> = [
        { dir: 'right', score: scores.right },
        { dir: 'left', score: scores.left },
        { dir: 'above', score: scores.top },
        { dir: 'below', score: scores.bottom },
      ]
      entries.sort((a, b) => b.score - a.score)
      const wallDir = entries[0]!.dir
      const awayDir = OPPOSITE_DIR[wallDir]
      // Order: away from wall first, then the two perpendicular, then toward wall last
      const perpendicular = (['right', 'left', 'above', 'below'] as LabelDirection[]).filter(
        (d) => d !== wallDir && d !== awayDir
      )
      dirOrder = [awayDir, ...perpendicular, wallDir]
    } else {
      // No wall data or empty/transparent area: prefer right, then below/above; avoid left until last
      // so two symbols side-by-side don't force the left one's label far left
      dirOrder = ['right', 'below', 'above', 'left']
    }

    // Flatten candidates in preferred order
    const candidatePositions: Array<{ x: number; y: number }> = []
    for (const dir of dirOrder) {
      for (const pos of candidatesByDir[dir]) {
        candidatePositions.push(pos)
      }
    }

    // Prefer a position free of label/symbol/wall overlap; among those, minimize wire overlap.
    let foundPosition = false
    let bestCleanCandidate: { x: number; y: number; wireOverlap: number } | null = null
    let bestCandidate = candidatePositions[0]!
    let minPenalty = Infinity

    for (const candidate of candidatePositions) {
      const boxBase = centerToBox(candidate.x, candidate.y, labelWidth, labelHeight)
      const box = {
        id: placement.id,
        x: boxBase.x,
        y: boxBase.y,
        width: boxBase.width,
        height: boxBase.height,
      }

      let hasCollision = false
      let labelOverlapArea = 0

      for (const existingBox of labelBoxes) {
        const expandedBox = {
          x: box.x - labelSpacing,
          y: box.y - labelSpacing,
          width: box.width + labelSpacing * 2,
          height: box.height + labelSpacing * 2,
        }

        const overlaps =
          expandedBox.x < existingBox.x + existingBox.width &&
          expandedBox.x + expandedBox.width > existingBox.x &&
          expandedBox.y < existingBox.y + existingBox.height &&
          expandedBox.y + expandedBox.height > existingBox.y

        if (overlaps) {
          hasCollision = true
          const overlapX = Math.max(
            0,
            Math.min(expandedBox.x + expandedBox.width, existingBox.x + existingBox.width) -
              Math.max(expandedBox.x, existingBox.x)
          )
          const overlapY = Math.max(
            0,
            Math.min(expandedBox.y + expandedBox.height, existingBox.y + existingBox.height) -
              Math.max(expandedBox.y, existingBox.y)
          )
          labelOverlapArea += overlapX * overlapY
        }
      }

      const symbolPadding = labelSpacing + 4
      let hasSymbolCollision = false
      let symbolOverlapArea = 0
      placements.forEach((otherPlacement) => {
        const otherInfo = placementInfoById.get(otherPlacement.id)
        const b = otherInfo?.bounds
        if (!b) return
        const expandedSymbol = {
          left: b.left - symbolPadding,
          right: b.right + symbolPadding,
          top: b.top - symbolPadding,
          bottom: b.bottom + symbolPadding,
        }
        const overlaps =
          box.x < expandedSymbol.right &&
          box.x + box.width > expandedSymbol.left &&
          box.y < expandedSymbol.bottom &&
          box.y + box.height > expandedSymbol.top
        if (overlaps) {
          hasSymbolCollision = true
          const overlapX = Math.max(
            0,
            Math.min(box.x + box.width, expandedSymbol.right) - Math.max(box.x, expandedSymbol.left)
          )
          const overlapY = Math.max(
            0,
            Math.min(box.y + box.height, expandedSymbol.bottom) -
              Math.max(box.y, expandedSymbol.top)
          )
          symbolOverlapArea += overlapX * overlapY
        }
      })

      let hasWallCollision = false
      let wallOverlapArea = 0
      if (wallObstacleRects && wallObstacleRects.length > 0) {
        for (const wr of wallObstacleRects) {
          const overlaps =
            box.x < wr.right &&
            box.x + box.width > wr.left &&
            box.y < wr.bottom &&
            box.y + box.height > wr.top
          if (overlaps) {
            hasWallCollision = true
            const overlapX = Math.max(
              0,
              Math.min(box.x + box.width, wr.right) - Math.max(box.x, wr.left)
            )
            const overlapY = Math.max(
              0,
              Math.min(box.y + box.height, wr.bottom) - Math.max(box.y, wr.top)
            )
            wallOverlapArea += overlapX * overlapY
          }
        }
      }

      let wireOverlapArea = 0
      if (wireObstacleRects) {
        const nearbyWireObstacleRects = queryWireObstacles(wireObstacleRects, {
          left: box.x,
          right: box.x + box.width,
          top: box.y,
          bottom: box.y + box.height,
        })
        for (const wr of nearbyWireObstacleRects) {
          const overlaps =
            box.x < wr.right &&
            box.x + box.width > wr.left &&
            box.y < wr.bottom &&
            box.y + box.height > wr.top
          if (!overlaps) continue
          const overlapX = Math.max(
            0,
            Math.min(box.x + box.width, wr.right) - Math.max(box.x, wr.left)
          )
          const overlapY = Math.max(
            0,
            Math.min(box.y + box.height, wr.bottom) - Math.max(box.y, wr.top)
          )
          wireOverlapArea += overlapX * overlapY
        }
      }

      if (!hasCollision && !hasSymbolCollision && !hasWallCollision) {
        if (!bestCleanCandidate || wireOverlapArea < bestCleanCandidate.wireOverlap) {
          bestCleanCandidate = {
            x: candidate.x,
            y: candidate.y,
            wireOverlap: wireOverlapArea,
          }
        }
        continue
      }

      // Symbol/wall overlap is hard; wire overlap is soft (acceptable fallback).
      const hardPenalty =
        (hasSymbolCollision ? symbolOverlapArea * 10_000 + 1_000_000 : 0) +
        (hasWallCollision ? wallOverlapArea * 10_000 + 1_000_000 : 0)
      const penalty = labelOverlapArea + hardPenalty + wireOverlapArea * 80

      if (penalty < minPenalty) {
        minPenalty = penalty
        bestCandidate = candidate
      }
    }

    if (bestCleanCandidate) {
      positions.set(placement.id, { x: bestCleanCandidate.x, y: bestCleanCandidate.y })
      const boxBase = centerToBox(
        bestCleanCandidate.x,
        bestCleanCandidate.y,
        labelWidth,
        labelHeight
      )
      labelBoxes.push({
        id: placement.id,
        x: boxBase.x,
        y: boxBase.y,
        width: boxBase.width,
        height: boxBase.height,
      })
      foundPosition = true
    }

    if (!foundPosition) {
      positions.set(placement.id, { x: bestCandidate.x, y: bestCandidate.y })
      const boxBase = centerToBox(bestCandidate.x, bestCandidate.y, labelWidth, labelHeight)
      labelBoxes.push({
        id: placement.id,
        x: boxBase.x,
        y: boxBase.y,
        width: boxBase.width,
        height: boxBase.height,
      })
    }
  })

  return positions
}
