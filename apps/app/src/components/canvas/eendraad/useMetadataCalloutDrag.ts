import { useCallback, useContext, useState } from 'react'
import type { KonvaEventObject } from 'konva/lib/Node'
import type { Point } from '@/types/ui'
import {
  setMetadataCalloutOffset,
  type MetadataCalloutOwnerRef,
} from '@/handlers/eendraad/metadataCalloutOffset'
import { MetadataCalloutDragContext } from './MetadataCalloutDragContext'

type CardGestureEvent = KonvaEventObject<DragEvent | MouseEvent | TouchEvent>

/**
 * Makes a one-wire metadata card draggable. The card position is local to the
 * owner's symbol, so the committed offset is the dragged group's own x/y. The
 * project is updated once, on drag end, which records a single undo step.
 */
export function useMetadataCalloutDrag(
  owner: MetadataCalloutOwnerRef,
  placement: Point
): {
  draggable: boolean
  x: number
  y: number
  dx: number
  dy: number
  isDragging: boolean
  dragHandlers: {
    onMouseDown?: (event: CardGestureEvent) => void
    onTouchStart?: (event: CardGestureEvent) => void
    onDragStart?: (event: CardGestureEvent) => void
    onDragMove?: (event: CardGestureEvent) => void
    onDragEnd?: (event: CardGestureEvent) => void
  }
} {
  const canDrag = useContext(MetadataCalloutDragContext)
  const [dragPlacement, setDragPlacement] = useState<Point | null>(null)
  const { type: ownerType, id: ownerId } = owner

  const readPosition = useCallback((event: CardGestureEvent): Point | null => {
    event.cancelBubble = true
    if (event.target !== event.currentTarget) return null
    return { x: event.target.x(), y: event.target.y() }
  }, [])
  const stopPointerBubble = useCallback((event: CardGestureEvent) => {
    // Keep the parent symbol, marquee selection and canvas pan out of the card gesture.
    event.cancelBubble = true
  }, [])
  const handleDragMove = useCallback(
    (event: CardGestureEvent) => {
      const position = readPosition(event)
      if (position) setDragPlacement(position)
    },
    [readPosition]
  )
  const handleDragEnd = useCallback(
    (event: CardGestureEvent) => {
      const position = readPosition(event)
      setDragPlacement(null)
      if (position) setMetadataCalloutOffset({ type: ownerType, id: ownerId }, position)
    },
    [ownerId, ownerType, readPosition]
  )

  const rendered = dragPlacement ?? placement
  return {
    draggable: canDrag,
    x: rendered.x,
    y: rendered.y,
    dx: rendered.x - placement.x,
    dy: rendered.y - placement.y,
    isDragging: dragPlacement != null,
    dragHandlers: canDrag
      ? {
          onMouseDown: stopPointerBubble,
          onTouchStart: stopPointerBubble,
          onDragStart: handleDragMove,
          onDragMove: handleDragMove,
          onDragEnd: handleDragEnd,
        }
      : {},
  }
}
