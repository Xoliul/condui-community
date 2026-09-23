import React from 'react'
import CanvasScaledOverlay from './CanvasScaledOverlay'

export interface CanvasSelectionPathItem {
  id: string
  label: string
  selected?: boolean
  unresolved?: boolean
  alternativeCount?: number
  disabled?: boolean
  title?: string
  /** Non-interactive placeholder marking a clipped span of the path. */
  ellipsis?: boolean
}

export function CanvasSelectionPath({
  items,
  themeMode,
  ariaLabel,
  onSelect,
  onHover,
}: {
  items: CanvasSelectionPathItem[]
  themeMode: 'light' | 'dark'
  ariaLabel: string
  onSelect: (item: CanvasSelectionPathItem) => void
  onHover: (item: CanvasSelectionPathItem | null) => void
}) {
  if (!items.length) return null

  return (
    <CanvasScaledOverlay
      data-canvas-overlay-anchor="top-center"
      className="absolute left-1/2 top-3 z-20 max-w-[min(72%,56rem)] -translate-x-1/2"
      transformOrigin="top center"
      resolveTransform={(scale) => `translateX(-50%) scale(${scale})`}
    >
      <nav
        aria-label={ariaLabel}
        data-theme-mode={themeMode}
        className="flex max-w-full items-center overflow-x-auto whitespace-nowrap rounded bg-black/40 px-3 py-1.5 text-sm font-bold text-amber-400 shadow-sm backdrop-blur-sm dark:bg-gray-700/50"
      >
        {items.map((item, index) => (
          <React.Fragment key={`${item.id}:${index}`}>
            {index > 0 && (
              <span aria-hidden="true" className="mx-2 shrink-0 text-amber-400">
                →
              </span>
            )}
            {item.ellipsis ? (
              <span className="shrink-0 select-none px-0.5 text-amber-400/70" title={item.title}>
                …
              </span>
            ) : item.alternativeCount ? (
              <span
                className="shrink-0 rounded border border-amber-400/50 px-1.5 py-0.5"
                title={item.title}
              >
                +{item.alternativeCount}
              </span>
            ) : (
              <button
                type="button"
                disabled={item.disabled}
                aria-current={item.selected ? 'step' : undefined}
                title={item.title}
                className={`shrink-0 rounded px-0.5 transition-opacity hover:opacity-80 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-400 ${
                  item.selected ? 'underline decoration-2 underline-offset-2' : ''
                } ${item.unresolved ? 'text-orange-400' : ''}`}
                onMouseEnter={() => onHover(item)}
                onMouseLeave={() => onHover(null)}
                onFocus={() => onHover(item)}
                onBlur={() => onHover(null)}
                onClick={() => onSelect(item)}
              >
                {item.label}
              </button>
            )}
          </React.Fragment>
        ))}
      </nav>
    </CanvasScaledOverlay>
  )
}
