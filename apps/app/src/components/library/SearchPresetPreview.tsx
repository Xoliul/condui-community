import { useEffect, useState } from 'react'
import { Group, Image, Layer, Line, Stage, Text } from 'react-konva'
import { loadProcessedSymbol, SYMBOL_EXPORT_ATTR_SVG_PATH } from '@/lib/symbolImage'
import { getSearchPresetArtwork } from '@/lib/library/searchPresetArtwork'
import { useDetailedProtectionSymbols } from '@/hooks/useProtectionSymbolSvgPath'
import { resolveProtectionSvgPath } from '@/lib/detailedProtectionSymbols'
import { useSettingsStore } from '@/stores/settingsStore'

/** Lightweight artwork, shared by the gallery, touch ghost, armed badge and plan hover. */
export function SearchPresetCanvasSymbol({
  symbolId,
  presetId,
  plan = false,
}: {
  symbolId: string
  presetId: string
  plan?: boolean
}) {
  const isDark = useSettingsStore((state) => state.theme?.mode === 'dark')
  const [loaded, setLoaded] = useState<{ key: string; images: HTMLImageElement[] } | null>(null)
  const detailed = useDetailedProtectionSymbols()
  const key = `${symbolId}:${presetId}:${isDark}:${detailed}`
  useEffect(() => {
    let cancelled = false
    const artwork = getSearchPresetArtwork(symbolId, presetId, plan)
    if (artwork)
      void Promise.all(
        artwork.paths.map((path) => loadProcessedSymbol(resolveProtectionSvgPath(path, detailed), isDark))
      )
        .then((images) => {
          if (!cancelled) setLoaded({ key, images })
        })
        .catch(() => {
          if (!cancelled) setLoaded(null)
        })
    return () => {
      cancelled = true
    }
  }, [symbolId, presetId, isDark, key, plan, detailed])
  const artwork = getSearchPresetArtwork(symbolId, presetId, plan)
  if (!artwork) return null
  const color = isDark ? '#fff' : '#000'
  return (
    <Group listening={false}>
      {loaded?.key === key &&
        loaded.images.map((image, index) => (
          <Image
            key={artwork.paths[index]}
            image={image}
            width={20}
            height={20}
            offsetX={10}
            offsetY={10}
            {...{ [SYMBOL_EXPORT_ATTR_SVG_PATH]: resolveProtectionSvgPath(artwork.paths[index], detailed) }}
          />
        ))}
      {artwork.lines.map((points, index) => (
        <Line key={index} points={points} stroke={color} strokeWidth={1} />
      ))}
      {artwork.waterproof && <Text text="h" x={8} y={-13} fontSize={8} fill={color} />}
    </Group>
  )
}

export function SearchPresetPreview({
  symbolId,
  presetId,
}: {
  symbolId: string
  presetId: string
}) {
  // Match the plain library icons: the 20-unit symbol fills the 32px box, centred. Only shrink
  // when the preset draws extra geometry outside the symbol (wall line, waterproof mark).
  const artwork = getSearchPresetArtwork(symbolId, presetId)
  const extent = Math.max(
    10,
    ...(artwork?.lines.flat().map((value) => Math.abs(value) + 0.5) ?? []),
    artwork?.waterproof ? 13.5 : 0
  )
  const scale = 16 / extent
  return (
    <div className="h-8 w-8" data-search-preset={presetId} aria-hidden="true">
      <Stage width={32} height={32} listening={false}>
        <Layer listening={false}>
          <Group x={16} y={16} scaleX={scale} scaleY={scale}>
            <SearchPresetCanvasSymbol symbolId={symbolId} presetId={presetId} />
          </Group>
        </Layer>
      </Stage>
    </div>
  )
}
