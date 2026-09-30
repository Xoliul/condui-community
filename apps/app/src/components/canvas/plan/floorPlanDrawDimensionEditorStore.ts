import { create } from 'zustand'
import type { Point2 } from '@/types/schema'

export interface FloorPlanDrawDimensionField {
  id: string
  anchor: Point2
  placement: 'center' | 'above' | 'right'
  value: string
  active: boolean
  /** True while `value` is a live measurement (not user-typed): the first typed character replaces it. */
  live?: boolean
  rotationDeg?: number
}

export interface FloorPlanDrawDimensionEditor {
  ownerId: string
  fields: FloorPlanDrawDimensionField[]
  onActivate: (id: string) => void
  onChange: (id: string, value: string) => void
  onEnter: () => void
  onTab: () => void
  onEscape: () => void
}

export const useFloorPlanDrawDimensionEditor = create<{
  editor: FloorPlanDrawDimensionEditor | null
}>(() => ({ editor: null }))

export function setFloorPlanDrawDimensionEditor(editor: FloorPlanDrawDimensionEditor | null) {
  useFloorPlanDrawDimensionEditor.setState({ editor })
}

export function clearFloorPlanDrawDimensionEditor(ownerId: string) {
  if (useFloorPlanDrawDimensionEditor.getState().editor?.ownerId !== ownerId) return
  useFloorPlanDrawDimensionEditor.setState({ editor: null })
}
