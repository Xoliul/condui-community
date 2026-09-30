import { getLocalizedSymbolName } from '@/lib/symbolNames'
/**
 * Mini library for "Add element" at right-click position (1draad or plan).
 * Shows favorites first (if any), then full list; search focused by default.
 * The search is local: it must not filter (or be hidden behind) the sidebar library.
 */

import { useEffect, useRef, useMemo, useState, type KeyboardEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { Search, X } from 'lucide-react'
import { useLibraryStore } from '@/stores/libraryStore'
import type { SymbolMetadata } from '@/lib/symbols'
import type { Point } from '@/types/ui'
import { canSymbolAppearOnSituationPlan } from '@/lib/plan/situationPlanSymbolEligibility'
import { isSymbolAvailableInLibrary } from '@/lib/supplyTopologyFeature'
import { filterBySearchRelevance } from '@/utils/search'

const ADD_ELEMENT_DROP_MARGIN = 12

export type AddElementScope = 'eendraad' | 'situatieplan'

function filterByScope(symbols: SymbolMetadata[], scope: AddElementScope): SymbolMetadata[] {
  if (scope === 'eendraad') {
    return symbols.filter((s) => s.scope === 'eendraad' || s.scope === 'both')
  }
  return symbols.filter((s) => canSymbolAppearOnSituationPlan(s.id))
}

interface AddElementPickerProps {
  /** Canvas position where element will be dropped (used when user picks a symbol) */
  dropPosition: Point
  onSelect: (symbol: SymbolMetadata, position: Point) => void
  onClose: () => void
  /** Which symbols to show: 1draad or plan (sitplan) */
  scope?: AddElementScope
  /** Hide symbols that cannot be placed at `dropPosition`. */
  canPlaceSymbol?: (symbol: SymbolMetadata) => boolean
}

export default function AddElementPicker({
  dropPosition,
  onSelect,
  onClose,
  scope = 'eendraad',
  canPlaceSymbol,
}: AddElementPickerProps) {
  const { t, i18n } = useTranslation()
  const locale = i18n.language
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)

  const [searchQuery, setSearchQuery] = useState('')
  const [activeIndex, setActiveIndex] = useState(0)
  const symbols = useLibraryStore((s) => s.symbols)
  const getSymbolById = useLibraryStore((s) => s.getSymbolById)
  const favoriteSymbols = useLibraryStore((s) => s.favoriteSymbols)

  useEffect(() => {
    const t = setTimeout(() => inputRef.current?.focus(), 50)
    return () => clearTimeout(t)
  }, [])

  const getLocalizedName = (symbol: SymbolMetadata) => {
    return getLocalizedSymbolName(symbol, locale)
  }

  const favoritesList = useMemo(() => {
    const list = favoriteSymbols
      .map((id) => getSymbolById(id))
      .filter((s): s is SymbolMetadata => !!s)
    const scoped = filterByScope(list, scope)
    return canPlaceSymbol ? scoped.filter(canPlaceSymbol) : scoped
  }, [favoriteSymbols, getSymbolById, scope, canPlaceSymbol])

  const filteredList = useMemo(() => {
    const available = filterByScope(symbols.filter(isSymbolAvailableInLibrary), scope)
    const placeable = canPlaceSymbol ? available.filter(canPlaceSymbol) : available
    return filterBySearchRelevance(placeable, searchQuery.trim(), (s) => [
      s.name,
      getLocalizedSymbolName(s, locale),
      s.nameNL,
      s.nameFR,
      ...s.tags,
    ])
  }, [symbols, scope, canPlaceSymbol, searchQuery, locale])

  const displayList = useMemo(() => {
    if (searchQuery) return filteredList
    if (favoritesList.length > 0) {
      const rest = filteredList.filter((s) => !favoriteSymbols.includes(s.id))
      return [...favoritesList, ...rest]
    }
    return filteredList
  }, [searchQuery, favoritesList, filteredList, favoriteSymbols])

  const handlePick = (symbol: SymbolMetadata) => {
    onSelect(symbol, dropPosition)
    onClose()
  }

  useEffect(() => {
    setActiveIndex(0)
  }, [searchQuery])

  useEffect(() => {
    listRef.current
      ?.querySelector<HTMLElement>(`[data-picker-index="${activeIndex}"]`)
      ?.scrollIntoView({ block: 'nearest' })
  }, [activeIndex])

  const handleSearchKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      if (displayList.length === 0) return
      const step = e.key === 'ArrowDown' ? 1 : -1
      setActiveIndex((index) => (index + step + displayList.length) % displayList.length)
    } else if (e.key === 'Enter') {
      e.preventDefault()
      const symbol = displayList[Math.min(activeIndex, displayList.length - 1)]
      if (symbol) handlePick(symbol)
    } else if (e.key === 'Escape') {
      e.preventDefault()
      e.stopPropagation()
      onClose()
    }
  }

  return (
    <div
      data-app-modal-backdrop="true"
      className="fixed inset-0 z-[100] flex items-center justify-center p-3 sm:p-4 bg-black/30"
      onClick={onClose}
    >
      <div
        className="flex flex-col w-full max-w-md rounded-md bg-white dark:bg-gray-800 shadow-xl border border-gray-200 dark:border-gray-700 overflow-hidden"
        style={{ maxHeight: 'min(70vh, 28rem)' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200 dark:border-gray-700">
          <h3 className="text-lg font-semibold text-gray-900 dark:text-white">
            {t('contextMenu.addElement')}
          </h3>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-500 dark:text-gray-400"
            aria-label={t('common.close', 'Close')}
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="px-4 py-3 border-b border-gray-200 dark:border-gray-700">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input
              ref={inputRef}
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onKeyDown={handleSearchKeyDown}
              placeholder={t('common.search')}
              className="w-full pl-9 pr-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-gray-900 dark:text-white placeholder-gray-500 dark:placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-sky-500"
            />
          </div>
        </div>

        <div ref={listRef} className="flex-1 overflow-y-auto min-h-0 p-2">
          {displayList.length === 0 ? (
            <div className="p-4 text-center text-gray-500 dark:text-gray-400 text-sm">
              {searchQuery ? t('common.noResults', 'No results') : t('symbols.noSymbols', 'No symbols')}
            </div>
          ) : (
            <div className="space-y-1">
              {displayList.map((symbol, index) => (
                <button
                  key={symbol.id}
                  type="button"
                  data-picker-index={index}
                  onClick={() => handlePick(symbol)}
                  onMouseMove={() => setActiveIndex(index)}
                  className={`w-full flex items-center gap-3 px-3 py-2 rounded-md text-left transition-colors ${
                    index === activeIndex
                      ? 'bg-gray-100 dark:bg-gray-700'
                      : 'hover:bg-gray-100 dark:hover:bg-gray-700'
                  }`}
                >
                  <div className="w-10 h-10 flex-shrink-0 flex items-center justify-center bg-gray-100 dark:bg-gray-700 rounded">
                    <img
                      src={symbol.svgPath}
                      alt=""
                      className="w-6 h-6 object-contain dark:invert"
                    />
                  </div>
                  <span className="text-sm font-medium text-gray-900 dark:text-white truncate">
                    {getLocalizedName(symbol)}
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="px-4 py-2 border-t border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900/50 text-xs text-gray-500 dark:text-gray-400">
          {displayList.length} {t('symbols.symbols', 'symbols')}
        </div>
      </div>
    </div>
  )
}

export { ADD_ELEMENT_DROP_MARGIN }
