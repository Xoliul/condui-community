import { useMemo } from 'react'
import { Group, Circle, Line, Rect } from 'react-konva'
import {
  collectDropZoneHints,
  isRelocationDropZoneHintCompatible,
  isRelocationNoOpDropZoneHint,
  resolveActiveDropZoneHintNodeId,
  type DropZoneHintRelocation,
} from '@/lib/layout/collectDropZoneHints'
import { SECONDARY_BUS_PREVIEW_STUB_LENGTH, type DropTarget } from '@/lib/layout/findDropTarget'
import type { LayoutTree } from '@/lib/layout/layoutTree'
import {
  declutterDropZoneHints,
  getDropZoneHintProximity,
  getMinimumScreenSizeScale,
} from '@/lib/layout/dropZoneHintDeclutter'
import { useEffectiveCanvasZoom } from '@/hooks/useEffectiveCanvasZoom'
import { ZOOM_100 } from '@/constants/canvasConstants'
import type { SymbolMetadata } from '@/lib/symbols'
import type { ProjectWithOptionalV2Electrical } from '@/lib/projectV2/electrical'
import type { Point } from '@/types/ui'

/** Matches drag-preview accent (EendraadCanvas / DragPreview). */
const PREVIEW_STROKE = '#0284c7'
const PREVIEW_FILL = 'rgba(2, 132, 199, 0.12)'
const PREVIEW_DASH = [6, 4]
const HINT_RADIUS = 8
const SECONDARY_BUS_STUB_WIDTH = 4
/** Minimum on-screen radius (px) of a hint under the pointer when zoomed out. */
const HINT_MIN_SCREEN_RADIUS = 11
/** Resting opacity of hints far from the pointer; they stay readable but recede. */
const HINT_FAINT_OPACITY = 0.5
/** Resting size of far hints relative to a hint under the pointer. */
const HINT_FAINT_SCALE = 0.8
const HINT_STROKE_WIDTH = 1.5
/** Extra gap (in hint radii) so neighbouring circles never touch. */
const HINT_SPACING_RADII = 2.5

interface DropZoneHintsOverlayProps {
  layoutTree: LayoutTree | null
  project: ProjectWithOptionalV2Electrical | null
  symbol: SymbolMetadata | null
  activeDropTarget?: DropTarget | null
  activeDropTargetNodeId?: string | null
  activePosition?: Point | null
  /** Pointer during the drag; hints fade in as it gets close. */
  pointerPosition?: Point | null
  relocation?: DropZoneHintRelocation | null
  movingPanelAttachmentId?: string | null
}

export function DropZoneHintsOverlay({
  layoutTree,
  project,
  symbol,
  activeDropTarget = null,
  activeDropTargetNodeId = null,
  activePosition = null,
  pointerPosition = null,
  relocation = null,
  movingPanelAttachmentId = null,
}: DropZoneHintsOverlayProps) {
  const hints = useMemo(() => {
    if (!layoutTree || !project || !symbol) return []
    return collectDropZoneHints(symbol, layoutTree, project, { movingPanelAttachmentId })
  }, [layoutTree, project, symbol, movingPanelAttachmentId])

  const activeHintNodeId = useMemo(
    () =>
      resolveActiveDropZoneHintNodeId(
        hints,
        activeDropTarget,
        activeDropTargetNodeId,
        activePosition
      ),
    [hints, activeDropTarget, activeDropTargetNodeId, activePosition]
  )

  const zoom = useEffectiveCanvasZoom(ZOOM_100, 'eendraad')
  // Hints keep a readable screen size when zoomed out and scale with the diagram when zoomed in.
  const sizeScale = getMinimumScreenSizeScale(HINT_RADIUS, zoom, HINT_MIN_SCREEN_RADIUS)
  const fullRadius = HINT_RADIUS * sizeScale

  const visibleHints = useMemo(() => {
    const sameSymbolHints = hints.filter((h) =>
      h.nodeId.startsWith('same-symbol-add-more-')
    )
    const activeHint = hints.find((hint) => hint.nodeId === activeHintNodeId) ?? null
    const candidates = hints.filter((hint) => {
      if (!isRelocationDropZoneHintCompatible(hint, relocation)) return false
      if (isRelocationNoOpDropZoneHint(hint, relocation)) return false
      if (hint.nodeId !== activeHintNodeId || hint.nodeId.startsWith('same-symbol-add-more-')) {
        // Hide regular circle hints that overlap with a same-symbol-add-more square,
        // but keep trunk-top hints (they sit in a different visual zone).
        if (
          !hint.nodeId.startsWith('same-symbol-add-more-') &&
          !hint.nodeId.includes('circuit-trunk-') &&
          sameSymbolHints.length > 0
        ) {
          const tooClose = sameSymbolHints.some(
            (s) => Math.abs(s.x - hint.x) < 30 && Math.abs(s.y - hint.y) < 30
          )
          if (tooClose) return false
        }
        return true
      }
      return false
    })
    return declutterDropZoneHints(candidates, activeHint, fullRadius * HINT_SPACING_RADII)
  }, [hints, activeHintNodeId, relocation, fullRadius])

  if (visibleHints.length === 0) return null

  const scaledDash = PREVIEW_DASH.map((length) => length * sizeScale)
  const proximityOf = (hint: { x: number; y: number }) =>
    getDropZoneHintProximity(hint, pointerPosition, zoom)
  const opacityFor = (proximity: number) =>
    HINT_FAINT_OPACITY + (1 - HINT_FAINT_OPACITY) * proximity

  return (
    <Group listening={false} name="drop-zone-hints">
      {visibleHints.map((hint) => {
        const proximity = proximityOf(hint)
        const radius = fullRadius * (HINT_FAINT_SCALE + (1 - HINT_FAINT_SCALE) * proximity)
        return hint.outline ? (
          <Group key={hint.nodeId} opacity={opacityFor(proximity)} listening={false}>
            <Rect
              {...hint.outline}
              fill={PREVIEW_FILL}
              stroke={PREVIEW_STROKE}
              strokeWidth={2 * sizeScale}
              dash={scaledDash}
              listening={false}
            />
            {hint.nodeId.startsWith('same-symbol-add-more-') && (
              <>
                <Circle
                  x={hint.x}
                  y={hint.y}
                  radius={7 * sizeScale}
                  fill={PREVIEW_FILL}
                  stroke={PREVIEW_STROKE}
                  strokeWidth={HINT_STROKE_WIDTH * sizeScale}
                  listening={false}
                />
                <Line
                  points={[hint.x - 3 * sizeScale, hint.y, hint.x + 3 * sizeScale, hint.y]}
                  stroke={PREVIEW_STROKE}
                  strokeWidth={HINT_STROKE_WIDTH * sizeScale}
                  listening={false}
                />
                <Line
                  points={[hint.x, hint.y - 3 * sizeScale, hint.x, hint.y + 3 * sizeScale]}
                  stroke={PREVIEW_STROKE}
                  strokeWidth={HINT_STROKE_WIDTH * sizeScale}
                  listening={false}
                />
              </>
            )}
          </Group>
        ) : (
          <Group key={hint.nodeId} opacity={opacityFor(proximity)} listening={false}>
            {hint.secondaryBusPreviewY != null && (
              <Line
                points={[
                  hint.x,
                  hint.secondaryBusPreviewY,
                  hint.x + SECONDARY_BUS_PREVIEW_STUB_LENGTH,
                  hint.secondaryBusPreviewY,
                ]}
                stroke={PREVIEW_STROKE}
                strokeWidth={SECONDARY_BUS_STUB_WIDTH * sizeScale}
                dash={scaledDash}
                lineCap="round"
                listening={false}
              />
            )}
            <Circle
              x={hint.x}
              y={hint.y}
              radius={radius}
              fill={PREVIEW_FILL}
              stroke={PREVIEW_STROKE}
              strokeWidth={HINT_STROKE_WIDTH * sizeScale}
              dash={scaledDash}
              listening={false}
            />
          </Group>
        )
      })}
    </Group>
  )
}
