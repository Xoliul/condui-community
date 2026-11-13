import { useCallback, useEffect } from 'react'
import type Konva from 'konva'
import type { LayoutNode } from '@/lib/layout/layoutTree'
import { useOneWireDragGhostStore } from '@/stores/oneWireDragGhostStore'
import type { Point } from '@/types/ui'

/** Diagram-space position of a dragged node, even while it lives on the isolated drag layer. */
function getDiagramPosition(target: Konva.Node): Point | null {
  const content = target.getStage()?.findOne('.canvas-content')
  return content
    ? content.getAbsoluteTransform().copy().invert().point(target.getAbsolutePosition())
    : null
}

/**
 * Drives the downstream-circuit ghost for a protection drag: the circuit below the
 * protection travels with it on drop, so it is shown moving with the pointer.
 */
export function useDownstreamDragGhost(protectionId: string, downstreamNode?: LayoutNode) {
  const begin = useOneWireDragGhostStore((state) => state.begin)
  const follow = useOneWireDragGhostStore((state) => state.follow)
  const end = useOneWireDragGhostStore((state) => state.end)
  const activeProtectionId = useOneWireDragGhostStore((state) => state.protectionId)
  const hasDownstream = !!downstreamNode?.children.length

  useEffect(() => {
    return activeProtectionId === protectionId ? end : undefined
  }, [activeProtectionId, protectionId, end])

  const beginGhost = useCallback(
    (target: Konva.Node) => {
      const origin = hasDownstream ? getDiagramPosition(target) : null
      if (origin) begin(protectionId, origin.x, origin.y)
    },
    [begin, hasDownstream, protectionId]
  )
  const followGhost = useCallback(
    (target: Konva.Node) => {
      const now = getDiagramPosition(target)
      if (now) follow(now.x, now.y)
    },
    [follow]
  )
  return { beginGhost, followGhost, endGhost: end }
}
