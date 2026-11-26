import { Image } from 'react-konva'
import { DOMOTICA_BOX_WIDTH, SYMBOL_SIZE } from '@/components/canvas/eendraad/canvasSymbols'
import { DOMOTICA_CONTROL_OVERLAY_PATHS } from '@/lib/symbols'
import type { DomoticaControlKey } from '@/types/schema'

const CONTROL_ICON_KEYS = [
  'programmed_control',
  'wireless_control',
  'detection_control',
  'button_control',
] as const

/** Active control icons in the top band of the vertical domotica frame. */
export function DomoticaControlIcons({
  activeKeys,
  images,
  outlineX,
  centerY,
}: {
  activeKeys: ReadonlySet<DomoticaControlKey>
  images: Partial<Record<DomoticaControlKey, HTMLImageElement | null>>
  outlineX: number
  centerY: number
}) {
  const keys = CONTROL_ICON_KEYS.filter(
    (key): key is (typeof CONTROL_ICON_KEYS)[number] & keyof typeof DOMOTICA_CONTROL_OVERLAY_PATHS =>
      activeKeys.has(key)
  )
  return keys.map((key, index) => {
    const image = images[key]
    if (!image) return null
    const size = SYMBOL_SIZE * 0.3
    return (
      <Image
        key={key}
        image={image}
        width={size}
        height={size}
        offsetX={size / 2}
        offsetY={size / 2}
        x={outlineX + (DOMOTICA_BOX_WIDTH * (index + 1)) / (keys.length + 1)}
        y={centerY}
        listening={false}
      />
    )
  })
}
