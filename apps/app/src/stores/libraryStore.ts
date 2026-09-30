import { getLocalizedSymbolName } from '@/lib/symbolNames'
import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { symbols, type SymbolMetadata } from '@/lib/symbols'
import { filterBySearchRelevance } from '@/utils/search'
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

      getSymbolById: (id) => get().symbols.find((s) => s.id === id && isSymbolAvailableInLibrary(s)),

      getFilteredSymbols: (locale = 'en') => {
        const { symbols, searchQuery, selectedCategory } = get()
        let filtered = symbols.filter(isSymbolAvailableInLibrary)

        // Filter by category
        if (selectedCategory) {
          filtered = filtered.filter((s) => s.category === selectedCategory)
        }

        // Filter by search query with fuzzy matching and synonyms
        if (searchQuery) {
          const normalizedQuery = normalizeLibrarySearchText(searchQuery)
          const isShortPrefixQuery =
            normalizedQuery.length > 0 &&
            normalizedQuery.length <= 2 &&
            !normalizedQuery.includes(' ')

          if (isShortPrefixQuery) {
            return filtered.filter((symbol) =>
              normalizeLibrarySearchText(getLocalizedSymbolName(symbol, locale)).startsWith(normalizedQuery)
            )
          }

          filtered = filterBySearchRelevance(filtered, searchQuery, (s) => {
            // Check all name variations and tags, preferring literal matches.
            return [
              s.name,
              getLocalizedSymbolName(s, locale),
              s.nameNL,
              s.nameFR,
              ...s.tags,
            ]
          })
        }

        return filtered
      },

      getSymbolsByCategory: (category) => {
        return get().symbols.filter(
          (s) => s.category === category && isSymbolAvailableInLibrary(s)
        )
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

function normalizeLibrarySearchText(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ')
}
