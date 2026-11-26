import { INTERACTIVE_OVERLAY_EXPORT_NAME } from '@/lib/export/interactiveOverlayExport'
import { useState } from 'react'
import { Group, Rect, Text } from 'react-konva'
import {
  getMultiplierBadgePosition,
  getMultiplierBadgeText,
  getMultiplierBadgeWidth,
  MULTIPLIER_BADGE_FONT_SIZE,
  MULTIPLIER_BADGE_HEIGHT,
} from '@/lib/eendraad/multiplierBadgeGeometry'
import { useCanvasPanOrClickGesture } from './CanvasPanOrClickGesture'

interface MultiplierBadgeProps {
  count: number
  anchorX: number
  anchorY: number
  fill: string
  fontFamily?: string
  onActivate: () => void
}

export function MultiplierBadge({
  count,
  anchorX,
  anchorY,
  fill,
  fontFamily,
  onActivate,
}: MultiplierBadgeProps) {
  const [hovered, setHovered] = useState(false)
  const text = getMultiplierBadgeText(count)
  const width = getMultiplierBadgeWidth(count)
  const height = MULTIPLIER_BADGE_HEIGHT
  const position = getMultiplierBadgePosition({ x: anchorX, y: anchorY }, count)
  const gestureHandlers = useCanvasPanOrClickGesture(() => onActivate())

  return (
    <Group
      x={position.x}
      y={position.y}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      {...gestureHandlers}
    >
      <Rect
        x={-1}
        y={-1}
        width={width + 2}
        height={height + 2}
        name={INTERACTIVE_OVERLAY_EXPORT_NAME} fill="rgba(0,0,0,0.001)"
        stroke={hovered ? fill : undefined}
        strokeWidth={hovered ? 0.75 : 0}
        dash={[2, 2]}
        cornerRadius={1.5}
      />
      <Text
        text={text}
        width={width}
        height={height}
        fontSize={MULTIPLIER_BADGE_FONT_SIZE}
        fontStyle="bold"
        wrap="none"
        fontFamily={fontFamily}
        fill={fill}
        listening={false}
      />
    </Group>
  )
}
