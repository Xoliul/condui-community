import type { RefObject } from 'react'
import { Circle, Group, Line, Rect } from 'react-konva'
import type Konva from 'konva'
import type { CircuitTrunkBranchSlot } from '@/lib/layout/circuitTrunkBranchSlots'

/** Matches the main-bus drag preview accent. */
const PREVIEW_COLOR = '#0284c7'
const PREVIEW_OPACITY = 0.6
const SLOT_STUB_LENGTH = 48

interface TrunkBranchSlotPreviewProps {
  slot: CircuitTrunkBranchSlot
  /** Sliding marker; the drag handler moves it directly between renders. */
  markerRef?: RefObject<Konva.Circle | null>
}

/**
 * Vertical counterpart of the main-bus move preview: the trunk is highlighted, a marker
 * slides with the pointer, and a stub marks the gap the moved branches will take.
 */
export function TrunkBranchSlotPreview({ slot, markerRef }: TrunkBranchSlotPreviewProps) {
  const stubEndX = slot.trunkX + slot.direction * SLOT_STUB_LENGTH
  return (
    <Group listening={false} name="trunk-branch-slot-preview">
      <Rect
        x={slot.trunkX - 2}
        y={slot.top}
        width={4}
        height={slot.bottom - slot.top}
        fill={PREVIEW_COLOR}
        opacity={PREVIEW_OPACITY * 0.5}
        listening={false}
      />
      <Line
        points={[slot.trunkX, slot.slotY, stubEndX, slot.slotY]}
        stroke={PREVIEW_COLOR}
        strokeWidth={3}
        dash={[6, 3]}
        lineCap="round"
        opacity={PREVIEW_OPACITY}
        listening={false}
      />
      <Circle
        x={slot.trunkX}
        y={slot.slotY}
        radius={4}
        fill={PREVIEW_COLOR}
        opacity={PREVIEW_OPACITY}
        listening={false}
      />
      <Circle
        ref={markerRef}
        x={slot.trunkX}
        y={slot.markerY}
        radius={15}
        fill={PREVIEW_COLOR}
        opacity={0.25}
        stroke={PREVIEW_COLOR}
        strokeWidth={2}
        listening={false}
      />
    </Group>
  )
}
