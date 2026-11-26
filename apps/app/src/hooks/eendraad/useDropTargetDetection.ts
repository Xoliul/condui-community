import { useCallback, type RefObject } from 'react'
import { findDropTarget } from '@/lib/layout/findDropTarget'
import type { DropTarget, FindDropTargetOptions } from '@/lib/layout/findDropTarget'
import { useLayoutTree } from './useLayoutTree'
import type { Point } from '@/types/ui'

/**
 * Hook to detect drop targets during drag operations using tree-based hit testing
 */
export function useDropTargetDetection(
  draggedIdRef?: RefObject<string | null>,
  dragSelectionIdsRef?: RefObject<string[] | null>
) {
  const layoutTree = useLayoutTree()
  
  return useCallback(
    (position: Point, options?: FindDropTargetOptions): DropTarget => {
      if (!layoutTree) {
        return { type: null }
      }
      const draggedId = draggedIdRef?.current
      const movingEndpointIds = options?.movingEndpointIds ?? (draggedId ? (dragSelectionIdsRef?.current ?? [draggedId]) : undefined)
      return findDropTarget(layoutTree, position, movingEndpointIds ? { ...options, movingEndpointIds } : options)
    },
    [layoutTree, draggedIdRef, dragSelectionIdsRef]
  )
}
