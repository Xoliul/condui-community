import { useEffect, useState } from 'react'
import { Image, Rect } from 'react-konva'
import { useDetailedProtectionSymbols } from '@/hooks/useProtectionSymbolSvgPath'
import { resolveProtectionSvgPath } from '@/lib/detailedProtectionSymbols'
import { getSymbolById } from '@/lib/symbols'
import { loadProcessedSymbol } from '@/lib/symbolImage'
import { useSettingsStore } from '@/stores/settingsStore'

export function CatalogSymbolImage({
  symbolId,
  width,
  height,
  offsetX = width / 2,
  offsetY = height / 2,
  fallbackStroke,
}: {
  symbolId: string
  width: number
  height: number
  offsetX?: number
  offsetY?: number
  fallbackStroke: string
}) {
  const theme = useSettingsStore((state) => state.theme)
  const detailedProtection = useDetailedProtectionSymbols()
  const [image, setImage] = useState<HTMLImageElement | null>(null)
  const symbol = getSymbolById(symbolId)
  const isDark = theme?.mode === 'dark'
  const [source, setSource] = useState({ symbol, isDark })
  if (source.symbol !== symbol || source.isDark !== isDark) {
    setSource({ symbol, isDark })
    setImage(null)
  }

  useEffect(() => {
    let cancelled = false
    if (!symbol) return
    loadProcessedSymbol(resolveProtectionSvgPath(symbol.svgPath, detailedProtection), isDark)
      .then((nextImage) => {
        if (!cancelled) setImage(nextImage)
      })
      .catch(() => {
        if (!cancelled) setImage(null)
      })
    return () => {
      cancelled = true
    }
  }, [isDark, symbol, detailedProtection])

  if (image) {
    return (
      <Image
        image={image}
        width={width}
        height={height}
        offsetX={offsetX}
        offsetY={offsetY}
        listening={false}
      />
    )
  }

  return (
    <Rect
      x={-offsetX}
      y={-offsetY}
      width={width}
      height={height}
      fill="transparent"
      stroke={fallbackStroke}
      strokeWidth={2}
      listening={false}
    />
  )
}
