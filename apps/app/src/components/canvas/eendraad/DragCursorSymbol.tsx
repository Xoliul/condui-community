import { useEffect, useState } from 'react'
import { Group, Image } from 'react-konva'
import { useSettingsStore } from '@/stores/settingsStore'
import { useDetailedProtectionSymbols } from '@/hooks/useProtectionSymbolSvgPath'
import { resolveProtectionSvgPath } from '@/lib/detailedProtectionSymbols'
import { getSymbolById } from '@/lib/symbols'
import { loadProcessedSymbol } from '@/lib/symbolImage'
import type { SymbolMetadata } from '@/lib/symbols'
import type { Point } from '@/types/ui'
import { SYMBOL_SIZE } from './canvasSymbols'

const CURSOR_PREVIEW_OPACITY = 0.85

interface DragCursorSymbolProps {
  position: Point
  symbolData: SymbolMetadata
}

/**
 * Symbol rendered at the pointer during internal drags (e.g. Alt-duplicate)
 * where there is no HTML5 setDragImage ghost like library drag.
 */
export function DragCursorSymbol({ position, symbolData }: DragCursorSymbolProps) {
  const theme = useSettingsStore((s) => s.theme)
  const detailedProtection = useDetailedProtectionSymbols()
  const [image, setImage] = useState<HTMLImageElement | null>(null)
  const [source, setSource] = useState({ id: symbolData.id, mode: theme?.mode })
  if (source.id !== symbolData.id || source.mode !== theme?.mode) {
    setSource({ id: symbolData.id, mode: theme?.mode })
    if (!getSymbolById(symbolData.id)?.svgPath) setImage(null)
  }

  useEffect(() => {
    const sym = getSymbolById(symbolData.id)
    if (!sym?.svgPath) return
    const isDark = theme?.mode === 'dark'
    let cancelled = false
    loadProcessedSymbol(resolveProtectionSvgPath(sym.svgPath, detailedProtection), isDark)
      .then((img) => {
        if (!cancelled) setImage(img)
      })
      .catch(() => {
        if (!cancelled) setImage(null)
      })
    return () => {
      cancelled = true
    }
  }, [symbolData.id, theme?.mode, detailedProtection])

  if (!image) return null

  return (
    <Group x={position.x} y={position.y} listening={false} name="drag-cursor-symbol">
      <Image
        image={image}
        width={SYMBOL_SIZE}
        height={SYMBOL_SIZE}
        offsetX={SYMBOL_SIZE / 2}
        offsetY={SYMBOL_SIZE / 2}
        opacity={CURSOR_PREVIEW_OPACITY}
        listening={false}
      />
    </Group>
  )
}
