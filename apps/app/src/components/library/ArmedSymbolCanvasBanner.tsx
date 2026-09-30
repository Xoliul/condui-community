import { getLocalizedSymbolName } from '@/lib/symbolNames'
import { useLayoutEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { X } from 'lucide-react'
import type { SymbolMetadata } from '@/lib/symbols'
import { symbolCategorySingularLabels } from '@/locales/symbolCategoryLabels'
import { useUIStore } from '@/stores/uiStore'
import CanvasScaledOverlay from '@/components/canvas/CanvasScaledOverlay'
import { SymbolPreview } from './SymbolItem'

const SHORT_NAME_MAX_CHARS = 24
const TOP_GAP_PX = 12
const BREADCRUMB_GAP_PX = 6

type LabelLang = keyof typeof symbolCategorySingularLabels

export function getArmedSymbolLabel(symbol: SymbolMetadata, language: string): string {
  const lang: LabelLang = language in symbolCategorySingularLabels ? (language as LabelLang) : 'en'
  const name = getLocalizedSymbolName(symbol, lang)
  if (name.length <= SHORT_NAME_MAX_CHARS) return name
  const categories = symbolCategorySingularLabels[lang] as Record<string, string>
  return categories[symbol.category] ?? name
}

function getFullSymbolName(symbol: SymbolMetadata, language: string): string {
  return getLocalizedSymbolName(symbol, language)
}

/**
 * Top-centre badge naming the armed library symbol on the canvas the pointer last hovered.
 * Sits below the canvas's selection breadcrumb when one is shown.
 */
export default function ArmedSymbolCanvasBanner({ symbol }: { symbol: SymbolMetadata }) {
  const { t, i18n } = useTranslation()
  const setArmedLibrarySymbol = useUIStore((state) => state.setArmedLibrarySymbol)
  const rootRef = useRef<HTMLDivElement>(null)
  const [top, setTop] = useState(TOP_GAP_PX)

  useLayoutEffect(() => {
    const root = rootRef.current
    const offsetParent = root?.offsetParent as HTMLElement | null
    // The canvas root holds the BaseCanvas container and its sibling overlays (breadcrumb).
    const canvasRoot = root?.parentElement?.parentElement
    if (!root || !offsetParent || !canvasRoot) return

    const measure = () => {
      const breadcrumb = canvasRoot.querySelector<HTMLElement>(
        ':scope > [data-canvas-overlay-anchor="top-center"]'
      )
      if (!breadcrumb) {
        setTop(TOP_GAP_PX)
        return
      }
      const crumbBottom = breadcrumb.getBoundingClientRect().bottom
      setTop(crumbBottom - offsetParent.getBoundingClientRect().top + BREADCRUMB_GAP_PX)
    }

    measure()
    const mutationObserver = new MutationObserver(measure)
    mutationObserver.observe(canvasRoot, { childList: true })
    const resizeObserver = new ResizeObserver(measure)
    resizeObserver.observe(canvasRoot)
    return () => {
      mutationObserver.disconnect()
      resizeObserver.disconnect()
    }
  }, [])

  const label = getArmedSymbolLabel(symbol, i18n.language)
  const fullName = getFullSymbolName(symbol, i18n.language)

  return (
    <div
      ref={rootRef}
      className="pointer-events-none absolute inset-x-0 z-20 flex justify-center px-16"
      style={{ top }}
    >
      <CanvasScaledOverlay
        role="status"
        aria-label={t('symbols.armed.placing', { name: fullName })}
        data-testid="armed-symbol-banner"
        title={fullName}
        transformOrigin="top center"
        className="pointer-events-auto flex min-w-0 max-w-full items-center gap-2 rounded-md border border-sky-500 bg-white py-1 pl-1.5 pr-1 shadow-md dark:border-sky-400 dark:bg-gray-800"
      >
        <div className="flex h-6 w-6 shrink-0 items-center justify-center [&>div]:h-6 [&>div]:w-6">
          <SymbolPreview svgPath={symbol.svgPath} symbolId={symbol.id} />
        </div>
        <span className="min-w-0 truncate text-sm font-medium text-gray-900 dark:text-white">
          {t('symbols.armed.placing', { name: label })}
        </span>
        <kbd className="shrink-0 rounded border border-gray-300 bg-gray-50 px-1.5 py-0.5 font-mono text-[11px] font-semibold leading-none text-gray-600 dark:border-gray-600 dark:bg-gray-900 dark:text-gray-300">
          Esc
        </kbd>
        <button
          type="button"
          onClick={() => setArmedLibrarySymbol(null)}
          className="shrink-0 rounded p-0.5 text-gray-500 hover:bg-gray-100 hover:text-gray-900 dark:text-gray-400 dark:hover:bg-gray-700 dark:hover:text-white"
          aria-label={t('symbols.armed.stop')}
          title={t('symbols.armed.stop')}
        >
          <X className="h-4 w-4" />
        </button>
      </CanvasScaledOverlay>
    </div>
  )
}
