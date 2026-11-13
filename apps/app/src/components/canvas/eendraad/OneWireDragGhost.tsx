import { useMemo, type ComponentProps } from 'react'
import { Group } from 'react-konva'
import { WireSegments } from '../WireSegment'
import { BoundedCanvasPreview } from '../shared/BoundedCanvasPreview'
import RenderNode from './RenderNode'
import { getPanelDiagramId, type BottomUpLayoutResult } from '@/lib/layout/bottomUpLayout'
import type { LayoutTree } from '@/lib/layout/layoutTree'
import { collectProtectionDragSubtree } from '@/lib/eendraad/protectionDragSubtree'
import { useOneWireDragGhostStore } from '@/stores/oneWireDragGhostStore'
import type { WireSegment } from '@/types/schema'

const GHOST_OPACITY = 0.55

type NodeProps = ComponentProps<typeof RenderNode>

interface OneWireDragGhostProps {
  layout: BottomUpLayoutResult | null
  layoutTree: LayoutTree | null
  wireSegments: WireSegment[]
  translate: NodeProps['translate']
  advancedPanelLabels: boolean
  getProtectionById: NodeProps['getProtectionById']
  getPanelById: NodeProps['getPanelById']
}

/**
 * Translucent copy of the circuit below a dragged protection, drawn with the real
 * wire and symbol renderers, so the user sees what a drop will move.
 */
export function OneWireDragGhost({
  layout,
  layoutTree,
  wireSegments,
  translate,
  advancedPanelLabels,
  getProtectionById,
  getPanelById,
}: OneWireDragGhostProps) {
  const protectionId = useOneWireDragGhostStore((state) => state.protectionId)
  const dx = useOneWireDragGhostStore((state) => state.dx)
  const dy = useOneWireDragGhostStore((state) => state.dy)
  const subtree = useMemo(
    () =>
      protectionId && layoutTree
        ? collectProtectionDragSubtree(layoutTree, protectionId, wireSegments)
        : null,
    [protectionId, layoutTree, wireSegments]
  )
  const panelLayout = useMemo(
    () => layout?.panels.find((candidate) => getPanelDiagramId(candidate) === subtree?.diagramId),
    [layout, subtree]
  )
  const content = useMemo(
    () =>
      subtree && panelLayout ? (
        <>
          <WireSegments
            panelId={panelLayout.panel.id}
            diagramId={subtree.diagramId}
            wireSegments={subtree.wireSegments}
          />
          {subtree.childNodes.map((node) => (
            <RenderNode
              key={node.id}
              node={node}
              panelLayout={panelLayout}
              disablePositionIsland
              disableViewportIsland
              translate={translate}
              advancedPanelLabels={advancedPanelLabels}
              getProtectionById={getProtectionById}
              getPanelById={getPanelById}
            />
          ))}
        </>
      ) : null,
    [subtree, panelLayout, translate, advancedPanelLabels, getProtectionById, getPanelById]
  )
  if (!content) return null
  return (
    <BoundedCanvasPreview>
      <Group name="one-wire-drag-ghost" x={dx} y={dy} opacity={GHOST_OPACITY} listening={false}>
        {content}
      </Group>
    </BoundedCanvasPreview>
  )
}
