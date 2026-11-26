import { useMemo } from 'react'
import { LocalSvgCanvasOverlay, type CanvasSvgOverlayItem } from '../shared/LocalSvgCanvasOverlay'
import {
  collectDropZoneHints,
  isRelocationDropZoneHintCompatible,
  isRelocationNoOpDropZoneHint,
  resolveActiveDropZoneHintNodeId,
  type DropZoneHintRelocation,
} from '@/lib/layout/collectDropZoneHints'
import { SECONDARY_BUS_PREVIEW_STUB_LENGTH, type DropTarget } from '@/lib/layout/findDropTarget'
import type { LayoutTree } from '@/lib/layout/layoutTree'
import { withoutRiserIneligibleHints } from '@/lib/layout/riserDropHintGuard'
import {
  withoutHintsAfterHorizontalDomotica,
  withoutSupplyHintsForHorizontalDomotica,
} from '@/lib/layout/horizontalDomoticaDropGuard'
import {
  declutterDropZoneHints,
  getDropZoneHintProximityForDistance,
  getMinimumScreenSizeScale,
} from '@/lib/layout/dropZoneHintDeclutter'
import { useEffectiveCanvasZoom } from '@/hooks/useEffectiveCanvasZoom'
import { ZOOM_100 } from '@/constants/canvasConstants'
import type { SymbolMetadata } from '@/lib/symbols'
import { isHorizontalDomoticaPreset } from '@/lib/library/libraryPresets'
import type { ProjectWithOptionalV2Electrical } from '@/lib/projectV2/electrical'
import type { Point } from '@/types/ui'

/** Matches drag-preview accent (EendraadCanvas / DragPreview). */
const PREVIEW_STROKE = '#0284c7'
const PREVIEW_FILL = 'rgba(2, 132, 199, 0.08)'
const PREVIEW_DASH = [4, 3]
const HINT_RADIUS = 8
const SECONDARY_BUS_STUB_WIDTH = 1.6
/** Minimum on-screen radius (px) of a hint under the pointer when zoomed out. */
const HINT_MIN_SCREEN_RADIUS = 11
/** Resting opacity of hints far from the pointer; they stay readable but recede. */
const HINT_FAINT_OPACITY = 0.12
/** Resting size of far hints relative to a hint under the pointer. */
const HINT_FAINT_SCALE = 0.8
const HINT_STROKE_WIDTH = 1.1
/** Extra gap (in hint radii) so neighbouring circles never touch. */
const HINT_SPACING_RADII = 2.5

function getHintPointerOpacity(item: CanvasSvgOverlayItem, distancePx: number | null): number {
  if (item.opacity === 1) return 1
  return HINT_FAINT_OPACITY +
    (1 - HINT_FAINT_OPACITY) * getDropZoneHintProximityForDistance(distancePx ?? Infinity)
}

interface DropZoneHintsOverlayProps {
  layoutTree: LayoutTree | null
  project: ProjectWithOptionalV2Electrical | null
  symbol: SymbolMetadata | null
  activeDropTarget?: DropTarget | null
  activeDropTargetNodeId?: string | null
  activeSameSymbolTargetNodeId?: string | null
  activePosition?: Point | null
  relocation?: DropZoneHintRelocation | null
  movingPanelAttachmentId?: string | null
  branchEndpointNodeIds?: ReadonlySet<string>
  branchCircuitIds?: ReadonlySet<string>
}

export function DropZoneHintsOverlay({
  layoutTree,
  project,
  symbol,
  activeDropTarget = null,
  activeDropTargetNodeId = null,
  activeSameSymbolTargetNodeId = null,
  activePosition = null,
  relocation = null,
  movingPanelAttachmentId = null,
  branchEndpointNodeIds,
  branchCircuitIds,
}: DropZoneHintsOverlayProps) {
  const hints = useMemo(() => {
    if (!layoutTree || !project || !symbol) return []
    return withoutSupplyHintsForHorizontalDomotica(
      layoutTree,
      withoutRiserIneligibleHints(withoutHintsAfterHorizontalDomotica(layoutTree, collectDropZoneHints(symbol, layoutTree, project, { movingPanelAttachmentId, suppressSameSymbolTargets: !!relocation })), symbol, project),
      relocation?.elementId,
      isHorizontalDomoticaPreset(symbol.id, symbol.searchPreset)
    )
  }, [layoutTree, project, symbol, movingPanelAttachmentId, relocation])

  const activeHintNodeId = useMemo(
    () =>
      activeSameSymbolTargetNodeId
        ? `same-symbol-add-more-${activeSameSymbolTargetNodeId}`
        : resolveActiveDropZoneHintNodeId(
            hints,
            activeDropTarget,
            activeDropTargetNodeId,
            activePosition
          ),
    [hints, activeDropTarget, activeDropTargetNodeId, activeSameSymbolTargetNodeId, activePosition]
  )

  const zoom = useEffectiveCanvasZoom(ZOOM_100, 'eendraad')
  // Hints keep a readable screen size when zoomed out and scale with the diagram when zoomed in.
  const sizeScale = getMinimumScreenSizeScale(HINT_RADIUS, zoom, HINT_MIN_SCREEN_RADIUS)
  const fullRadius = HINT_RADIUS * sizeScale

  const visibleHints = useMemo(() => {
    const activeHint = hints.find((hint) => hint.nodeId === activeHintNodeId) ?? null
    const candidates = hints.filter((hint) =>
      !branchEndpointNodeIds?.has(hint.nodeId.replace(/^same-symbol-add-more-/, '')) &&
      !(hint.targetType === 'circuit' && hint.match?.circuitId && branchCircuitIds?.has(hint.match.circuitId) &&
        !hint.match.dcBusId && !hint.match.converterDcConnection && typeof hint.match.secondaryBusInsertIndex !== 'number') &&
      isRelocationDropZoneHintCompatible(hint, relocation) &&
      !isRelocationNoOpDropZoneHint(hint, relocation)
    )
    return declutterDropZoneHints(candidates, activeHint, fullRadius * HINT_SPACING_RADII)
  }, [hints, activeHintNodeId, relocation, fullRadius, branchEndpointNodeIds, branchCircuitIds])

  // Target transitions change only these local SVGs, not the full Konva overlay.
  const items = useMemo<CanvasSvgOverlayItem[]>(() => {
    const dash = PREVIEW_DASH.map((length) => length * sizeScale).join(' ')
    const radius = fullRadius * HINT_FAINT_SCALE
    return visibleHints.map((hint) => {
      const sameSymbol = hint.nodeId.startsWith('same-symbol-add-more-')
      const circleRadius = hint.outline ? 7 * sizeScale : radius
      let left = hint.outline?.x ?? hint.x - circleRadius
      let top = hint.outline?.y ?? hint.y - circleRadius
      let right = hint.outline ? left + hint.outline.width : hint.x + circleRadius
      let bottom = hint.outline ? top + hint.outline.height : hint.y + circleRadius
      if (hint.outline && sameSymbol) {
        left = Math.min(left, hint.x - circleRadius)
        top = Math.min(top, hint.y - circleRadius)
        right = Math.max(right, hint.x + circleRadius)
        bottom = Math.max(bottom, hint.y + circleRadius)
      }
      if (!hint.outline && hint.secondaryBusPreviewY != null) {
        right = Math.max(right, hint.x + SECONDARY_BUS_PREVIEW_STUB_LENGTH)
        top = Math.min(top, hint.secondaryBusPreviewY)
        bottom = Math.max(bottom, hint.secondaryBusPreviewY)
      }
      const padding = (SECONDARY_BUS_STUB_WIDTH * sizeScale) / 2 + 1
      return {
        id: hint.nodeId,
        pointerAnchor: { x: hint.x, y: hint.y },
        opacity: hint.nodeId === activeHintNodeId ? 1 : HINT_FAINT_OPACITY,
        bounds: {
          x: left - padding,
          y: top - padding,
          width: right - left + padding * 2,
          height: bottom - top + padding * 2,
        },
        content: sameSymbol && hint.nodeId === activeHintNodeId ? null : hint.outline ? (
          <>
            <rect
              x={hint.outline.x}
              y={hint.outline.y}
              width={hint.outline.width}
              height={hint.outline.height}
              rx={hint.outline.cornerRadius}
              ry={hint.outline.cornerRadius}
              fill={PREVIEW_FILL}
              stroke={PREVIEW_STROKE}
              strokeWidth={1.25 * sizeScale}
              strokeDasharray={dash}
            />
            {sameSymbol && (
              <>
                <circle
                  cx={hint.x}
                  cy={hint.y}
                  r={7 * sizeScale}
                  fill={PREVIEW_FILL}
                  stroke={PREVIEW_STROKE}
                  strokeWidth={HINT_STROKE_WIDTH * sizeScale}
                />
                <line
                  x1={hint.x - 3 * sizeScale}
                  y1={hint.y}
                  x2={hint.x + 3 * sizeScale}
                  y2={hint.y}
                  stroke={PREVIEW_STROKE}
                  strokeWidth={HINT_STROKE_WIDTH * sizeScale}
                />
                <line
                  x1={hint.x}
                  y1={hint.y - 3 * sizeScale}
                  x2={hint.x}
                  y2={hint.y + 3 * sizeScale}
                  stroke={PREVIEW_STROKE}
                  strokeWidth={HINT_STROKE_WIDTH * sizeScale}
                />
              </>
            )}
          </>
        ) : (
          <>
            {hint.secondaryBusPreviewY != null && (
              <line
                x1={hint.x}
                y1={hint.secondaryBusPreviewY}
                x2={hint.x + SECONDARY_BUS_PREVIEW_STUB_LENGTH}
                y2={hint.secondaryBusPreviewY}
                stroke={PREVIEW_STROKE}
                strokeWidth={SECONDARY_BUS_STUB_WIDTH * sizeScale}
                strokeDasharray={dash}
                strokeLinecap="round"
              />
            )}
            <circle
              cx={hint.x}
              cy={hint.y}
              r={radius}
              fill={PREVIEW_FILL}
              stroke={PREVIEW_STROKE}
              strokeWidth={HINT_STROKE_WIDTH * sizeScale}
              strokeDasharray={dash}
            />
          </>
        ),
      }
    })
  }, [visibleHints, activeHintNodeId, fullRadius, sizeScale])

  return <LocalSvgCanvasOverlay name="drop-zone-hints" items={items} pointerOpacity={getHintPointerOpacity} />
}
