import { getLocalizedSymbolName } from '@/lib/symbolNames'
import { memo, useEffect, useState, useMemo, type FocusEvent, type KeyboardEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { Search, ChevronDown, ChevronRight, Star, Clock, X } from 'lucide-react'
import { useLibraryStore } from '@/stores/libraryStore'
import { useUIStore } from '@/stores/uiStore'
import { symbolCategories } from '@/lib/symbols'
import SymbolItem from './SymbolItem'
import type { SymbolMetadata } from '@/lib/symbols'
import { canSymbolAppearOnSituationPlan } from '@/lib/plan/situationPlanSymbolEligibility'
import { getSymbolLibraryTooltip } from '@/lib/symbolTooltips'
import { MODULAR_SOCKET_LIBRARY_ID } from '@/lib/socket/modularSocket'

/** Categories shown in the library when panel canvas is maximized */
const PANEL_VIEW_CATEGORIES = [
  'protection',
  'outlets',
  'domotica',
  'metering',
  'notes',
  'grid',
] as const
const SEARCH_COMMIT_DELAY_MS = 120

interface LibrarySearchFieldProps {
  query: string
  onCommit: (query: string) => void
  placeholder: string
  wrapperClassName?: string
  inputClassName: string
  iconClassName: string
  clearButtonClassName: string
  clearIconClassName: string
}

function LibrarySearchField({
  query,
  onCommit,
  placeholder,
  wrapperClassName = 'relative',
  inputClassName,
  iconClassName,
  clearButtonClassName,
  clearIconClassName,
}: LibrarySearchFieldProps) {
  const [draft, setDraft] = useState(query)

  useEffect(() => {
    setDraft(query)
  }, [query])

  useEffect(() => {
    if (draft === query) return
    const timeout = window.setTimeout(() => onCommit(draft), SEARCH_COMMIT_DELAY_MS)
    return () => window.clearTimeout(timeout)
  }, [draft, onCommit, query])

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== 'Enter') return
    onCommit(draft)
    event.currentTarget.blur()
  }

  const handleFocus = (event: FocusEvent<HTMLInputElement>) => {
    const input = event.currentTarget
    window.setTimeout(() => {
      input.scrollIntoView({ block: 'nearest', inline: 'nearest' })
    }, 60)
  }

  const clear = () => {
    setDraft('')
    onCommit('')
  }

  return (
    <div className={wrapperClassName}>
      <Search className={iconClassName} />
      <input
        type="search"
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={handleKeyDown}
        onFocus={handleFocus}
        enterKeyHint="search"
        placeholder={placeholder}
        // Hide the native WebKit clear button; the X button below already clears the query.
        className={`${inputClassName} [&::-webkit-search-cancel-button]:appearance-none`}
      />
      {draft && (
        <button type="button" onClick={clear} className={clearButtonClassName}>
          <X className={clearIconClassName} />
        </button>
      )}
    </div>
  )
}

interface LibraryPanelProps {
  onDragStart?: (symbol: SymbolMetadata) => void
  compact?: boolean
  compactOrientation?: 'portrait' | 'landscape'
}

function LibraryPanel({
  onDragStart,
  compact = false,
  compactOrientation = 'portrait',
}: LibraryPanelProps) {
  const { t, i18n } = useTranslation()
  const [expandedCategories, setExpandedCategories] = useState<Set<string>>(
    new Set(Object.keys(symbolCategories))
  )
  const [activeTab, setActiveTab] = useState<'all' | 'recent' | 'favorites'>('all')

  const searchQuery = useLibraryStore((state) => state.searchQuery)
  const setSearchQuery = useLibraryStore((state) => state.setSearchQuery)
  const getFilteredSymbols = useLibraryStore((state) => state.getFilteredSymbols)
  const getSymbolsByCategory = useLibraryStore((state) => state.getSymbolsByCategory)
  const recentSymbols = useLibraryStore((state) => state.recentSymbols)
  const favoriteSymbols = useLibraryStore((state) => state.favoriteSymbols)
  const getSymbolById = useLibraryStore((state) => state.getSymbolById)
  const toggleFavorite = useLibraryStore((state) => state.toggleFavorite)
  const viewMode = useUIStore((state) => state.viewMode)

  const toggleCategory = (category: string) => {
    setExpandedCategories((prev) => {
      const next = new Set(prev)
      if (next.has(category)) {
        next.delete(category)
      } else {
        next.add(category)
      }
      return next
    })
  }

  const getLocalizedName = (symbol: SymbolMetadata) => {
    const locale = i18n.language
    return getLocalizedSymbolName(symbol, locale)
  }

  const getRecentSymbolsList = () => {
    return recentSymbols.map((id) => getSymbolById(id)).filter(Boolean) as SymbolMetadata[]
  }

  const getFavoriteSymbolsList = () => {
    return favoriteSymbols.map((id) => getSymbolById(id)).filter(Boolean) as SymbolMetadata[]
  }

  const filterByScope = (symbols: SymbolMetadata[]) => {
    if (viewMode === 'eendraad') {
      return symbols.filter((s) => s.scope === 'eendraad' || s.scope === 'both')
    }
    if (viewMode === 'plan') {
      return symbols.filter((s) => canSymbolAppearOnSituationPlan(s.id))
    }
    if (viewMode === 'panel') {
      return symbols.filter(
        (s) =>
          s.id === MODULAR_SOCKET_LIBRARY_ID ||
          (PANEL_VIEW_CATEGORIES.includes(s.category as (typeof PANEL_VIEW_CATEGORIES)[number]) &&
            s.category !== 'outlets' &&
            (s.category !== 'grid' || s.id === 'panel_distribution')) ||
          s.id === 'panel_distribution'
      )
    }
    return symbols
  }

  const categoriesToShow = useMemo(() => {
    if (viewMode === 'panel') {
      return Object.fromEntries(
        PANEL_VIEW_CATEGORIES.filter((key) => key in symbolCategories).map((key) => [key, symbolCategories[key as keyof typeof symbolCategories]])
      )
    }
    return symbolCategories
  }, [viewMode])

  const renderSymbol = (symbol: SymbolMetadata) => (
    <SymbolItem
      key={symbol.id}
      symbol={symbol}
      onDragStart={onDragStart}
      localizedName={getLocalizedName(symbol)}
      tooltip={getSymbolLibraryTooltip(symbol.id, i18n.language)}
      isFavorite={favoriteSymbols.includes(symbol.id)}
      onToggleFavorite={toggleFavorite}
      compact={compact}
    />
  )

  const visibleSymbols = filterByScope(getFilteredSymbols(i18n.language))

  if (compact) {
    const compactSymbols = searchQuery
      ? visibleSymbols
      : activeTab === 'recent'
        ? filterByScope(getRecentSymbolsList())
        : activeTab === 'favorites'
          ? filterByScope(getFavoriteSymbolsList())
          : []
    const compactCategoryGroups = Object.entries(categoriesToShow)
      .map(([key]) => ({
        key,
        label: t(`symbols.categories.${key}`),
        symbols: filterByScope(getSymbolsByCategory(key)),
      }))
      .filter((group) => group.symbols.length > 0)
    const showCategoryGroups = activeTab === 'all' && !searchQuery

    if (compactOrientation === 'landscape') {
      return (
        <div className="flex h-full min-h-0 flex-col overflow-hidden bg-white dark:bg-gray-800">
          <div className="flex flex-shrink-0 flex-col gap-2 border-b border-gray-200 px-2 py-2 dark:border-gray-700">
            <LibrarySearchField
              query={searchQuery}
              onCommit={setSearchQuery}
              placeholder={t('common.search')}
              inputClassName="w-full rounded-md border border-gray-300 bg-white py-1.5 pl-8 pr-7 text-sm text-gray-900 placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-gray-500 dark:border-gray-600 dark:bg-gray-700 dark:text-white dark:placeholder-gray-400"
              iconClassName="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400"
              clearButtonClassName="absolute right-1.5 top-1/2 -translate-y-1/2 rounded p-1 hover:bg-gray-100 dark:hover:bg-gray-600"
              clearIconClassName="h-4 w-4 text-gray-400"
            />
            <div className="flex rounded-md border border-gray-200 dark:border-gray-700">
              {(['all', 'recent', 'favorites'] as const).map((tab) => (
                <button
                  key={tab}
                  type="button"
                  onClick={() => setActiveTab(tab)}
                  className={`flex h-8 flex-1 items-center justify-center px-2 text-xs font-medium ${
                    activeTab === tab
                      ? 'bg-gray-900 text-white dark:bg-white dark:text-gray-900'
                      : 'text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-700'
                  }`}
                  title={
                    tab === 'all' ? 'All' : tab === 'recent' ? t('symbols.recent') : t('symbols.favorites')
                  }
                >
                  {tab === 'all' ? 'All' : tab === 'recent' ? <Clock className="h-4 w-4" /> : <Star className="h-4 w-4" />}
                </button>
              ))}
            </div>
          </div>
          <div
            className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden px-2 py-2"
            data-library-scroll="true"
            style={{
              WebkitOverflowScrolling: 'touch',
              overscrollBehaviorY: 'contain',
              touchAction: 'pan-y',
            }}
          >
            {showCategoryGroups ? (
              <div className="space-y-3">
                {compactCategoryGroups.map((group) => (
                  <section key={group.key}>
                    <div className="mb-1 px-1 text-[11px] font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
                      {group.label}
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      {group.symbols.map(renderSymbol)}
                    </div>
                  </section>
                ))}
              </div>
            ) : compactSymbols.length === 0 ? (
              <div className="flex min-h-[8rem] items-center justify-center text-sm text-gray-500 dark:text-gray-400">
                No symbols found
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-2">{compactSymbols.map(renderSymbol)}</div>
            )}
          </div>
        </div>
      )
    }

    return (
      <div className="flex h-full min-h-0 flex-col overflow-hidden bg-white dark:bg-gray-800">
        <div className="flex flex-shrink-0 items-center gap-2 border-b border-gray-200 px-2 py-2 dark:border-gray-700">
          <LibrarySearchField
            query={searchQuery}
            onCommit={setSearchQuery}
            placeholder={t('common.search')}
            wrapperClassName="relative min-w-[9rem] flex-1"
            inputClassName="w-full rounded-md border border-gray-300 bg-white py-1.5 pl-8 pr-7 text-sm text-gray-900 placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-gray-500 dark:border-gray-600 dark:bg-gray-700 dark:text-white dark:placeholder-gray-400"
            iconClassName="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400"
            clearButtonClassName="absolute right-1.5 top-1/2 -translate-y-1/2 rounded p-1 hover:bg-gray-100 dark:hover:bg-gray-600"
            clearIconClassName="h-4 w-4 text-gray-400"
          />
          <div className="flex flex-shrink-0 rounded-md border border-gray-200 dark:border-gray-700">
            {(['all', 'recent', 'favorites'] as const).map((tab) => (
              <button
                key={tab}
                type="button"
                onClick={() => setActiveTab(tab)}
                className={`flex h-8 min-w-8 items-center justify-center px-2 text-xs font-medium ${
                  activeTab === tab
                    ? 'bg-gray-900 text-white dark:bg-white dark:text-gray-900'
                    : 'text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-700'
                }`}
                title={tab === 'all' ? 'All' : tab === 'recent' ? t('symbols.recent') : t('symbols.favorites')}
              >
                {tab === 'all' ? 'All' : tab === 'recent' ? <Clock className="h-4 w-4" /> : <Star className="h-4 w-4" />}
              </button>
            ))}
          </div>
        </div>
        <div
          className="min-h-0 flex-1 overflow-x-auto overflow-y-hidden px-2 py-2"
          data-library-scroll="true"
          style={{
            WebkitOverflowScrolling: 'touch',
            overscrollBehaviorX: 'contain',
            touchAction: 'pan-x',
          }}
        >
          <div className="flex h-full min-w-max items-start gap-3">
            {showCategoryGroups ? (
              compactCategoryGroups.map((group, index) => (
                <section
                  key={group.key}
                  className={`flex h-full flex-shrink-0 flex-col ${
                    index > 0 ? 'border-l border-gray-200 pl-3 dark:border-gray-700' : ''
                  }`}
                >
                  <div className="mb-1 px-1 text-[11px] font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
                    {group.label}
                  </div>
                  <div className="flex min-w-max items-start gap-2">
                    {group.symbols.map(renderSymbol)}
                  </div>
                </section>
              ))
            ) : compactSymbols.length === 0 ? (
              <div className="flex h-full min-w-[12rem] items-center justify-center text-sm text-gray-500 dark:text-gray-400">
                No symbols found
              </div>
            ) : (
              compactSymbols.map(renderSymbol)
            )}
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden bg-white dark:bg-gray-800">
      {/* Search Bar */}
      <div className="px-4 py-3 border-b border-gray-200 dark:border-gray-700">
        <LibrarySearchField
          query={searchQuery}
          onCommit={setSearchQuery}
          placeholder={t('common.search')}
          inputClassName="w-full pl-9 pr-8 py-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-gray-900 dark:text-white placeholder-gray-500 dark:placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-gray-500 dark:focus:ring-gray-400"
          iconClassName="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400"
          clearButtonClassName="absolute right-2 top-1/2 -translate-y-1/2 p-1 hover:bg-gray-100 dark:hover:bg-gray-600 rounded transition-colors"
          clearIconClassName="w-4 h-4 text-gray-400"
        />
      </div>

      {/* Tabs */}
      <div className="flex border-b border-gray-200 dark:border-gray-700">
        <button
          onClick={() => setActiveTab('all')}
          className={`flex-1 px-4 py-2 text-sm font-medium transition-colors ${
            activeTab === 'all'
              ? 'text-gray-900 dark:text-white border-b-2 border-gray-900 dark:border-white'
              : 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-200'
          }`}
        >
          All
        </button>
        <button
          onClick={() => setActiveTab('recent')}
          className={`flex-1 px-4 py-2 text-sm font-medium transition-colors flex items-center justify-center gap-1 ${
            activeTab === 'recent'
              ? 'text-gray-900 dark:text-white border-b-2 border-gray-900 dark:border-white'
              : 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-200'
          }`}
        >
          <Clock className="w-4 h-4" />
          {t('symbols.recent')}
        </button>
        <button
          onClick={() => setActiveTab('favorites')}
          className={`flex-1 px-4 py-2 text-sm font-medium transition-colors flex items-center justify-center gap-1 ${
            activeTab === 'favorites'
              ? 'text-gray-900 dark:text-white border-b-2 border-gray-900 dark:border-white'
              : 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-200'
          }`}
        >
          <Star className="w-4 h-4" />
          {t('symbols.favorites')}
        </button>
      </div>

      {/* Symbol List */}
      <div
        className="flex-1 overflow-y-auto"
        data-library-scroll="true"
        style={{
          WebkitOverflowScrolling: 'touch',
          overscrollBehaviorY: 'contain',
          touchAction: 'pan-y',
        }}
      >
        {activeTab === 'all' && (
          <div className="p-2">
            {searchQuery ? (
              // Filtered view (flat list)
              <div className="space-y-0.25">
                {visibleSymbols.length === 0 ? (
                  <div className="p-4 text-center text-gray-500 dark:text-gray-400 text-sm">
                    No symbols found
                  </div>
                ) : (
                  visibleSymbols.map(renderSymbol)
                )}
              </div>
            ) : (
              // Category view
              <div className="space-y-2">
                {Object.entries(categoriesToShow).map(([key, _label]) => {
                  const categorySymbols = filterByScope(getSymbolsByCategory(key))
                  if (categorySymbols.length === 0) return null

                  const isExpanded = expandedCategories.has(key)

                  return (
                    <div key={key} className="border-b border-gray-100 dark:border-gray-700">
                      <button
                        onClick={() => toggleCategory(key)}
                        className="w-full flex items-center justify-between px-3 py-2 hover:bg-gray-50 dark:hover:bg-gray-700/50 rounded transition-colors"
                      >
                        <span className="font-medium text-sm text-gray-700 dark:text-gray-300">
                          {t(`symbols.categories.${key}`)}
                        </span>
                        <div className="flex items-center gap-2">
                          <span className="text-xs text-gray-500 dark:text-gray-400">
                            {categorySymbols.length}
                          </span>
                          {isExpanded ? (
                            <ChevronDown className="w-4 h-4 text-gray-500" />
                          ) : (
                            <ChevronRight className="w-4 h-4 text-gray-500" />
                          )}
                        </div>
                      </button>
                      {isExpanded && (
                        <div className="pb-2 space-y-0.5">
                          {categorySymbols.map(renderSymbol)}
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        )}

        {activeTab === 'recent' && (
          <div className="p-2 space-y-0.5">
            {getRecentSymbolsList().length === 0 ? (
              <div className="p-4 text-center text-gray-500 dark:text-gray-400 text-sm">
                No recent symbols
              </div>
            ) : (
              filterByScope(getRecentSymbolsList()).map(renderSymbol)
            )}
          </div>
        )}

        {activeTab === 'favorites' && (
          <div className="p-2 space-y-0.5">
            {getFavoriteSymbolsList().length === 0 ? (
              <div className="p-4 text-center text-gray-500 dark:text-gray-400 text-sm">
                No favorite symbols
              </div>
            ) : (
              filterByScope(getFavoriteSymbolsList()).map(renderSymbol)
            )}
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="px-4 py-2 border-t border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900/50">
        <div className="text-xs text-gray-500 dark:text-gray-400">
          {activeTab === 'all' && searchQuery
            ? `${visibleSymbols.length} symbols found`
            : activeTab === 'recent'
            ? `${getRecentSymbolsList().length} recent`
            : activeTab === 'favorites'
            ? `${getFavoriteSymbolsList().length} favorites`
            : `${visibleSymbols.length} symbols`}
        </div>
      </div>
    </div>
  )
}

export default memo(LibraryPanel)
