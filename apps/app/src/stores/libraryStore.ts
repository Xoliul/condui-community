import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { symbols, type SymbolMetadata } from '@/lib/symbols'
import { getSearchPreset, parseLibraryEntryKey, withSearchPreset } from '@/lib/library/searchPresets'
import { searchLibrarySymbols } from '@/lib/library/librarySearch'
import { canSymbolAppearOnSituationPlan } from '@/lib/plan/situationPlanSymbolEligibility'
import { isSymbolAvailableInLibrary } from '@/lib/supplyTopologyFeature'

interface LibraryState {
  symbols: SymbolMetadata[]
  recentSymbols: string[]
  favoriteSymbols: string[]
  searchQuery: string
  selectedCategory: string | null

  // Actions
  loadSymbols: (symbols: SymbolMetadata[]) => void
  addToRecent: (symbolId: string) => void
  toggleFavorite: (symbolId: string) => void
  setSearchQuery: (query: string) => void
  setSelectedCategory: (category: string | null) => void
  getSymbolById: (id: string) => SymbolMetadata | undefined
  getFilteredSymbols: (locale?: string) => SymbolMetadata[]
  getSymbolsByCategory: (category: string) => SymbolMetadata[]
  getSymbolsByScope: (scope: 'eendraad' | 'situatieplan' | 'both') => SymbolMetadata[]
}

export const useLibraryStore = create<LibraryState>()(
  persist(
    (set, get) => ({
      symbols: symbols,
      recentSymbols: [],
      favoriteSymbols: [],
      searchQuery: '',
      selectedCategory: null,

      loadSymbols: (newSymbols) => set({ symbols: newSymbols }),

      addToRecent: (symbolId) =>
        set((state) => {
          const recent = [symbolId, ...state.recentSymbols.filter((id) => id !== symbolId)].slice(
            0,
            10
          )
          return { recentSymbols: recent }
        }),

      toggleFavorite: (symbolId) =>
        set((state) => {
          const isFavorite = state.favoriteSymbols.includes(symbolId)
          const favorites = isFavorite
            ? state.favoriteSymbols.filter((id) => id !== symbolId)
            : [...state.favoriteSymbols, symbolId]
          return { favoriteSymbols: favorites }
        }),

      setSearchQuery: (query) => set({ searchQuery: query }),

      setSelectedCategory: (category) => set({ selectedCategory: category }),

      // A key is a symbol ID, or `symbolId#presetId` for a search-preset result (see getLibraryEntryKey).
      getSymbolById: (key) => {
        const { symbolId, presetId } = parseLibraryEntryKey(key)
        const symbol = get().symbols.find((s) => s.id === symbolId && isSymbolAvailableInLibrary(s))
        if (!symbol || !presetId) return symbol
        const preset = getSearchPreset(symbolId, presetId)
        return preset && !preset.libraryEntry ? withSearchPreset(symbol, presetId) : undefined
      },

      getFilteredSymbols: (locale = 'en') => {
        const { symbols, searchQuery, selectedCategory } = get()
        const inCategory = selectedCategory
          ? symbols.filter((symbol) => symbol.category === selectedCategory)
          : symbols
        return searchQuery
          ? searchLibrarySymbols(inCategory, searchQuery, locale)
          : inCategory.filter(isSymbolAvailableInLibrary)
      },

      getSymbolsByCategory: (category) => {
        return get().symbols.filter((s) => s.category === category && isSymbolAvailableInLibrary(s))
      },

      getSymbolsByScope: (scope) => {
        return get().symbols.filter(
          (s) =>
            isSymbolAvailableInLibrary(s) &&
            (s.scope === scope || s.scope === 'both') &&
            (scope !== 'situatieplan' || canSymbolAppearOnSituationPlan(s.id))
        )
      },
    }),
    {
      name: 'eendra-library-storage',
      partialize: (state) => ({
        recentSymbols: state.recentSymbols,
        favoriteSymbols: state.favoriteSymbols,
      }),
    }
  )
)
