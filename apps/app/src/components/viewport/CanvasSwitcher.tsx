import { useState, useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { useUIStore } from '@/stores/uiStore'
import { CANVAS_ICONS } from './CanvasIcons'
import type { CanvasType } from '@/types/ui'
import { FloatingControl } from '@/components/canvas/FloatingControls'
import { LayoutSelector } from './LayoutSelector'
import { getAvailableCanvasTypes } from '@/lib/viewport/availableCanvasTypes'

const CANVAS_TYPES: CanvasType[] = getAvailableCanvasTypes()

interface CanvasSwitcherProps {
  panelIndex: number
  currentCanvas: CanvasType
  compact?: boolean
  compactOrientation?: 'portrait' | 'landscape'
}

export function CanvasSwitcher({
  panelIndex,
  currentCanvas,
  compact = false,
  compactOrientation = 'portrait',
}: CanvasSwitcherProps) {
  const { t } = useTranslation()
  const setPanelCanvas = useUIStore((s) => s.setPanelCanvas)
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)

  // Close menu whenever the current canvas type changes (e.g. via swap)
  useEffect(() => {
    setOpen(false)
  }, [currentCanvas, panelIndex])

  // Close on outside pointer so the menu does not stay open over the canvas or other panels
  useEffect(() => {
    if (!open) return
    const close = () => setOpen(false)
    const onPointerDown = (e: PointerEvent) => {
      const root = rootRef.current
      if (root && !root.contains(e.target as Node)) close()
    }
    document.addEventListener('pointerdown', onPointerDown, true)
    return () => document.removeEventListener('pointerdown', onPointerDown, true)
  }, [open])

  const Icon = CANVAS_ICONS[currentCanvas]

  return (
    <div ref={rootRef} className="relative">
      <FloatingControl
        icon={<Icon className="w-5 h-5 text-gray-700 dark:text-gray-300" />}
        label={t(`views.${currentCanvas}`)}
        variant="menu"
        side="left"
        open={open}
        onOpenChange={setOpen}
        triggerTestId="canvas-menu-trigger"
        suppressTooltip={compact}
      >
        <div className="rounded-md bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-600 shadow-lg py-2 min-w-[220px] text-sm space-y-2">
          <div className="space-y-1">
            {CANVAS_TYPES.map((type) => {
              const TypeIcon = CANVAS_ICONS[type]
              const isActive = type === currentCanvas
              return (
                <button
                  key={type}
                  data-testid={`canvas-switcher-option-${type}`}
                  onClick={() => {
                    setPanelCanvas(panelIndex, type)
                    setOpen(false)
                  }}
                  className={`w-full flex items-center gap-2 px-3 py-1.5 text-sm rounded-md transition-colors ${
                    isActive
                      ? 'bg-sky-50 dark:bg-sky-900/30 text-sky-700 dark:text-sky-300'
                      : 'text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700'
                  }`}
                >
                  <TypeIcon className="w-4 h-4" />
                  <span className="flex-1 text-left">{t(`views.${type}`)}</span>
                </button>
              )
            })}
          </div>

          <div className="border-t border-gray-200 dark:border-gray-700 pt-2 px-3 space-y-1">
            <div className="text-xs text-gray-500 dark:text-gray-400">
              {t('layout.presetLabel', 'Layout')}
            </div>
            <LayoutSelector
              compact={compact}
              compactOrientation={compactOrientation}
              sourcePanelIndex={panelIndex}
              onAfterPresetChange={() => setOpen(false)}
            />
          </div>
        </div>
      </FloatingControl>
    </div>
  )
}
