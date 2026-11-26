import { Text } from 'react-konva'
import { getSecondaryTextColor, getTextColor } from './canvasSymbols'

interface DcBusLabelsProps {
  /** Left end of the bar. */
  x: number
  label?: string
  notes?: string
  fontFamily?: string
  isDark: boolean
}

/** Name and notes under a DC bar; the notes sit below the name when both are shown. */
export function DcBusLabels({ x, label, notes, fontFamily, isDark }: DcBusLabelsProps) {
  const name = label?.trim()
  return (
    <>
      {!!name && (
        <Text x={x + 7} y={4} text={label} fontFamily={fontFamily} fontSize={10} fill={getTextColor(isDark)} />
      )}
      {!!notes && (
        <Text
          x={x + 7}
          y={name ? 16 : 4}
          text={notes}
          fontFamily={fontFamily}
          fontSize={8}
          fill={getSecondaryTextColor(isDark)}
          wrap="none"
          listening={false}
        />
      )}
    </>
  )
}
