import { Line, Text } from 'react-konva'

interface ImpulseSwitchCountMarkerProps {
  count: number
  size: number
  color: string
  fontFamily: string
}

/** Lower-right slash and count for impulse switches; positioned clear of the multiplier badge. */
export function ImpulseSwitchCountMarker({
  count,
  size,
  color,
  fontFamily,
}: ImpulseSwitchCountMarkerProps) {
  if (!Number.isFinite(count) || count <= 1) return null

  const fontSize = Math.max(5, size * 0.17)
  const countText = String(Math.floor(count))
  const countWidth = Math.max(size * 0.25, countText.length * fontSize * 0.72)

  return (
    <>
      <Line
        points={[size * 0.12, size * 0.12, size * 0.28, size * 0.28]}
        stroke={color}
        strokeWidth={Math.max(0.8, size * 0.025)}
        listening={false}
      />
      <Text
        text={countText}
        x={size * 0.35 - countWidth / 2}
        y={size * 0.35 - fontSize * 0.625}
        width={countWidth}
        height={fontSize * 1.25}
        fontSize={fontSize}
        fontFamily={fontFamily}
        fill={color}
        align="center"
        verticalAlign="middle"
        listening={false}
      />
    </>
  )
}
