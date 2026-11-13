import { createContext, useContext } from 'react'
import type { KonvaEventObject } from 'konva/lib/Node'

export type ForwardOverviewInteraction = (
  targetName: string,
  event: KonvaEventObject<Event>
) => void

export const OverviewInteractionContext = createContext<ForwardOverviewInteraction | null>(null)
export const OverviewPrecisionContext = createContext(true)

export function useOverviewInteraction(): ForwardOverviewInteraction {
  const forward = useContext(OverviewInteractionContext)
  if (!forward) throw new Error('Diagram overview requires its mounted-diagram interaction owner.')
  return forward
}
