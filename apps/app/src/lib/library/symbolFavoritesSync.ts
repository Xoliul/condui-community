import { logger } from '@/lib/logger'
import { useLibraryStore } from '@/stores/libraryStore'

/** Where favourite symbols are kept beyond this browser (an account, a self-hosted server). */
export interface SymbolFavoritesRemote {
  /** Stable id of the remote, so each browser merges its own list into it only once. */
  scope: string
  /** Returns null when the remote never stored favourites. */
  load(): Promise<string[] | null>
  save(favorites: string[]): Promise<void>
}

const SAVE_DELAY_MS = 1_000
const MERGED_SCOPES_STORAGE_KEY = 'eendra-symbol-favorites-merged'

function readMergedScopes(): string[] {
  try {
    const raw = window.localStorage.getItem(MERGED_SCOPES_STORAGE_KEY)
    const parsed: unknown = raw ? JSON.parse(raw) : []
    return Array.isArray(parsed) ? parsed.filter((value): value is string => typeof value === 'string') : []
  } catch {
    return []
  }
}

function markScopeMerged(scope: string): void {
  try {
    const scopes = readMergedScopes()
    if (scopes.includes(scope)) return
    window.localStorage.setItem(MERGED_SCOPES_STORAGE_KEY, JSON.stringify([...scopes, scope]))
  } catch {
    // Without storage the browser list merges again next time, which only re-adds favourites.
  }
}

export function normalizeFavoriteSymbols(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null
  return [...new Set(value.filter((id): id is string => typeof id === 'string' && id.length > 0))]
}

/**
 * The first time a browser meets a remote, its favourites are combined with the remote list;
 * after that the remote list is leading, so a favourite removed elsewhere stays removed.
 */
export function resolveFavoriteSymbols(
  local: string[],
  remote: string[] | null,
  alreadyMerged: boolean,
): { favorites: string[]; save: boolean } {
  if (remote === null) return { favorites: local, save: true }
  if (alreadyMerged) return { favorites: remote, save: false }
  const combined = [...remote, ...local.filter((id) => !remote.includes(id))]
  return { favorites: combined, save: combined.length !== remote.length }
}

function sameList(left: string[], right: string[]): boolean {
  return left.length === right.length && left.every((id, index) => id === right[index])
}

/** Keeps the library favourites in step with a remote copy. Returns a stop function. */
export function startSymbolFavoritesSync(remote: SymbolFavoritesRemote): () => void {
  let stopped = false
  let ready = false
  let saveTimer: ReturnType<typeof setTimeout> | null = null
  let lastRemote: string[] = []

  const save = (favorites: string[]) => {
    lastRemote = favorites
    void remote.save(favorites).catch((error: unknown) => {
      logger.error('Saving favourite symbols failed:', error)
    })
  }

  const scheduleSave = () => {
    if (saveTimer) clearTimeout(saveTimer)
    saveTimer = setTimeout(() => {
      saveTimer = null
      const favorites = useLibraryStore.getState().favoriteSymbols
      if (!sameList(favorites, lastRemote)) save(favorites)
    }, SAVE_DELAY_MS)
  }

  const pull = async () => {
    const loaded = normalizeFavoriteSymbols(await remote.load())
    if (stopped || saveTimer) return
    const local = useLibraryStore.getState().favoriteSymbols
    const resolved = resolveFavoriteSymbols(local, loaded, readMergedScopes().includes(remote.scope))
    lastRemote = loaded ?? []
    markScopeMerged(remote.scope)
    if (!sameList(local, resolved.favorites)) useLibraryStore.setState({ favoriteSymbols: resolved.favorites })
    if (resolved.save) save(resolved.favorites)
    ready = true
  }

  const unsubscribe = useLibraryStore.subscribe((state, previous) => {
    if (ready && state.favoriteSymbols !== previous.favoriteSymbols && !sameList(state.favoriteSymbols, lastRemote)) {
      scheduleSave()
    }
  })

  // Pick up changes made on another device when the user returns to this tab.
  const handleVisibilityChange = () => {
    if (document.visibilityState === 'visible' && ready) {
      void pull().catch((error: unknown) => logger.error('Loading favourite symbols failed:', error))
    }
  }
  const watchesVisibility = typeof document !== 'undefined' && typeof document.addEventListener === 'function'
  if (watchesVisibility) document.addEventListener('visibilitychange', handleVisibilityChange)

  void pull().catch((error: unknown) => logger.error('Loading favourite symbols failed:', error))

  return () => {
    stopped = true
    unsubscribe()
    if (watchesVisibility) document.removeEventListener('visibilitychange', handleVisibilityChange)
    if (saveTimer) {
      clearTimeout(saveTimer)
      saveTimer = null
      const favorites = useLibraryStore.getState().favoriteSymbols
      if (!sameList(favorites, lastRemote)) save(favorites)
    }
  }
}
