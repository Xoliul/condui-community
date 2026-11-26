import { getLocalizedSymbolName } from '@/lib/symbolNames'
import {
  memo,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useMemo,
  type FocusEvent,
  type KeyboardEvent,
  type ReactNode,
} from 'react'
import { useTranslation } from 'react-i18next'
import { Search, Star, Clock, X } from 'lucide-react'
import { useLibraryStore } from '@/stores/libraryStore'
import { useViewportWindowStore } from '@/components/viewport/ViewportWindowStore'
import { symbolCategories } from '@/lib/symbols'
import SymbolItem from './SymbolItem'
import type { SymbolMetadata } from '@/lib/symbols'
import { canSymbolAppearOnSituationPlan } from '@/lib/plan/situationPlanSymbolEligibility'
import { getSymbolLibraryTooltip } from '@/lib/symbolTooltips'
import { MODULAR_SOCKET_LIBRARY_ID } from '@/lib/socket/modularSocket'
import { isLibraryPresetEntryId } from '@/lib/library/libraryPresets'
import { getLibraryEntryKey } from '@/lib/library/searchPresets'
import LibraryCategoryRail from './LibraryCategoryRail'
import { useLibraryRailHotkeys } from './useLibraryRailHotkeys'
import {
  LIBRARY_RAIL_ALL,
  LIBRARY_RAIL_GROUPS,
  effectiveRailSelection,
  getVisibleRailGroupKeys,
  resolveCurrentRailGroup,
  selectRailEntry,
  selectRailGroup,
  type LibraryRailEntry,
  type LibraryRailGroupKey,
  type LibraryRailSelection,
} from '@/lib/library/libraryRailGroups'
import { getSymbolShortName } from '@/locales/symbolShortNames'
import { normalizeSupportedLanguage } from '@/utils/languageRouting'

/** Categories shown in the library when panel canvas is maximized */
const PANEL_VIEW_CATEGORIES = [
  'protection',
  'outlets',
  'domotica',
  'metering',
  'energyConversion',
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

  const [previousQuery, setPreviousQuery] = useState(query)
  if (previousQuery !== query) {
    setPreviousQuery(query)
    setDraft(query)
  }

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
  // The compact layout keeps its tabs; the full panel uses the rail selection.
  const [activeTab, setActiveTab] = useState<'all' | 'recent' | 'favorites'>('all')
  const [railSelection, setRailSelection] = useState<LibraryRailSelection>(LIBRARY_RAIL_ALL)
  const [currentGroup, setCurrentGroup] = useState<LibraryRailGroupKey | null>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)

  const searchQuery = useLibraryStore((state) => state.searchQuery)
  const setSearchQuery = useLibraryStore((state) => state.setSearchQuery)
  const getFilteredSymbols = useLibraryStore((state) => state.getFilteredSymbols)
  const getSymbolsByCategory = useLibraryStore((state) => state.getSymbolsByCategory)
  const recentSymbols = useLibraryStore((state) => state.recentSymbols)
  const favoriteSymbols = useLibraryStore((state) => state.favoriteSymbols)
  const getSymbolById = useLibraryStore((state) => state.getSymbolById)
  const toggleFavorite = useLibraryStore((state) => state.toggleFavorite)
  const viewMode = useViewportWindowStore((state) => state.viewMode)

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
      // Presets with their own entry (horizontal domotica) are one-wire only.
      return symbols.filter(
        (s) =>
          !isLibraryPresetEntryId(s.id) &&
          (s.id === MODULAR_SOCKET_LIBRARY_ID ||
          (PANEL_VIEW_CATEGORIES.includes(s.category as (typeof PANEL_VIEW_CATEGORIES)[number]) &&
            s.category !== 'outlets' &&
            (s.category === 'grid'
              ? s.id === 'panel_distribution' || s.id === 'terminal_strip'
              : s.category !== 'energyConversion' ||
                s.id === 'transformer' ||
                s.id === 'inverter')) ||
          s.id === 'panel_distribution')
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

  const language = normalizeSupportedLanguage(i18n.language) ?? 'nl-BE'

  const renderSymbol = (symbol: SymbolMetadata) => (
    <SymbolItem
      key={getLibraryEntryKey(symbol)}
      symbol={symbol}
      onDragStart={onDragStart}
      localizedName={getLocalizedName(symbol)}
      tooltip={getSymbolLibraryTooltip(symbol.id, i18n.language)}
      isFavorite={favoriteSymbols.includes(getLibraryEntryKey(symbol))}
      onToggleFavorite={toggleFavorite}
      compact={compact}
      dense={!compact}
      listName={compact || symbol.searchPreset ? undefined : getSymbolShortName(symbol.id, language)}
    />
  )

  const visibleSymbols = filterByScope(getFilteredSymbols(i18n.language))

  // Rail groups that have symbols in this view; one-item categories are merged for display only.
  const railGroups = LIBRARY_RAIL_GROUPS.map((group) => ({
    group,
    symbols: group.categories
      .filter((category) => category in categoriesToShow)
      .flatMap((category) => filterByScope(getSymbolsByCategory(category))),
  })).filter(({ symbols }) => symbols.length > 0)
  const railGroupKeys = railGroups.map(({ group }) => group.key)
  const selection = effectiveRailSelection(railSelection, railGroupKeys)
  const visibleGroupKeys = getVisibleRailGroupKeys(selection, railGroupKeys)
  const visibleGroups = railGroups.filter(({ group }) => visibleGroupKeys.includes(group.key))

  const updateCurrentGroup = () => {
    const list = listRef.current
    if (!list) return
    const sections = Array.from(list.querySelectorAll<HTMLElement>('[data-library-rail-section]'), (element) => ({
      key: element.dataset.libraryRailSection as LibraryRailGroupKey,
      top: element.getBoundingClientRect().top,
    }))
    setCurrentGroup(resolveCurrentRailGroup(sections, list.getBoundingClientRect().top + 8))
  }

  useLayoutEffect(() => {
    if (!compact) updateCurrentGroup()
    // updateCurrentGroup only reads the rendered list; run after every render of the full panel.
  })

  const resetList = () => {
    setSearchQuery('')
    listRef.current?.scrollTo({ top: 0 })
  }
  const handleSelectEntry = (entry: LibraryRailEntry) => {
    setRailSelection(selectRailEntry(entry))
    resetList()
  }
  const handleSelectGroup = (key: LibraryRailGroupKey, additive: boolean) => {
    setRailSelection(selectRailGroup(selection, key, additive))
    resetList()
  }
  useLibraryRailHotkeys(panelRef, !compact, (key, additive) => {
    if (!railGroupKeys.includes(key)) return false
    handleSelectGroup(key, additive)
    return true
  })

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

  const emptyMessage = (text: string) => (
    <div className="p-4 text-center text-sm text-gray-500 dark:text-gray-400">{text}</div>
  )
  const recentSymbolsList = getRecentSymbolsList()
  const favoriteSymbolsList = getFavoriteSymbolsList()
  const showSections = !searchQuery && visibleGroups.length > 1
  const listedCount = searchQuery
    ? visibleSymbols.length
    : visibleGroups.reduce((total, { symbols }) => total + symbols.length, 0)

  let listContent: ReactNode
  if (searchQuery) {
    listContent = (
      <div className="space-y-0.5 px-1 py-2">
        {visibleSymbols.length === 0 ? emptyMessage('No symbols found') : visibleSymbols.map(renderSymbol)}
      </div>
    )
  } else if (selection.kind === 'recent' || selection.kind === 'favorites') {
    const entries = selection.kind === 'recent' ? recentSymbolsList : favoriteSymbolsList
    listContent = (
      <div className="space-y-0.5 px-1 py-2">
        {entries.length === 0
          ? emptyMessage(selection.kind === 'recent' ? 'No recent symbols' : 'No favorite symbols')
          : filterByScope(entries).map(renderSymbol)}
      </div>
    )
  } else if (showSections) {
    listContent = (
      <div className="px-1 pb-2">
        {visibleGroups.map(({ group, symbols }) => (
          <section key={group.key} data-library-rail-section={group.key} className="pb-2">
            <div className="sticky top-0 z-10 bg-white/95 pb-1 pl-0.5 pr-2 pt-2 text-[11px] font-semibold uppercase tracking-wide text-gray-500 dark:bg-gray-800/95 dark:text-gray-400">
              {group.key === 'other' ? t('symbols.rail.other') : t(`symbols.categories.${group.key}`)}
            </div>
            <div className="ml-1 space-y-0.5">{symbols.map(renderSymbol)}</div>
          </section>
        ))}
      </div>
    )
  } else {
    listContent = (
      <div className="space-y-0.5 px-1 py-2">{(visibleGroups[0]?.symbols ?? []).map(renderSymbol)}</div>
    )
  }

  return (
    <div ref={panelRef} className="flex h-full min-h-0 flex-col overflow-hidden bg-white dark:bg-gray-800">
      <div className="border-b border-gray-200 px-3 pb-2 pt-3 dark:border-gray-700">
        <LibrarySearchField
          query={searchQuery}
          onCommit={setSearchQuery}
          placeholder={t('common.search')}
          inputClassName="w-full rounded-md border border-gray-300 bg-white py-1.5 pl-8 pr-7 text-sm text-gray-900 placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-gray-500 dark:border-gray-600 dark:bg-gray-700 dark:text-white dark:placeholder-gray-400 dark:focus:ring-gray-400"
          iconClassName="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400"
          clearButtonClassName="absolute right-1.5 top-1/2 -translate-y-1/2 rounded p-1 transition-colors hover:bg-gray-100 dark:hover:bg-gray-600"
          clearIconClassName="h-4 w-4 text-gray-400"
        />
      </div>

      <div className="flex min-h-0 flex-1">
        <LibraryCategoryRail
          groupKeys={railGroupKeys}
          selection={selection}
          searching={Boolean(searchQuery)}
          currentGroup={currentGroup}
          onSelectEntry={handleSelectEntry}
          onSelectGroup={handleSelectGroup}
        />
        <div
          ref={listRef}
          onScroll={updateCurrentGroup}
          className="relative mr-[3px] min-w-0 flex-1 overflow-y-auto"
          data-library-scroll="true"
          style={{
            WebkitOverflowScrolling: 'touch',
            overscrollBehaviorY: 'contain',
            touchAction: 'pan-y',
          }}
        >
          {listContent}
        </div>
      </div>

      {/* Footer */}
      <div className="border-t border-gray-200 bg-gray-50 px-4 py-2 dark:border-gray-700 dark:bg-gray-900/50">
        <div className="text-xs text-gray-500 dark:text-gray-400">
          {searchQuery
            ? `${listedCount} symbols found`
            : selection.kind === 'recent'
              ? `${recentSymbolsList.length} recent`
              : selection.kind === 'favorites'
                ? `${favoriteSymbolsList.length} favorites`
                : `${listedCount} symbols`}
        </div>
      </div>
    </div>
  )
}

export default memo(LibraryPanel)
