import { useEffect } from 'react'
import { normalizeFavoriteSymbols, startSymbolFavoritesSync } from '@/lib/library/symbolFavoritesSync'
import { getServerSetting, isServerStorageEnabled, putServerSetting } from './communityServerStorage'

const SYMBOL_FAVORITES_SETTING_KEY = 'symbolFavorites'

/** With server storage, favourite symbols live in the server's settings like the folders do. */
export function useCommunitySymbolFavoritesSync(): void {
  useEffect(() => {
    let stop: (() => void) | null = null
    let cancelled = false
    void isServerStorageEnabled().then((enabled) => {
      if (!enabled || cancelled) return
      stop = startSymbolFavoritesSync({
        scope: 'community-server',
        load: async () => normalizeFavoriteSymbols(await getServerSetting<unknown>(SYMBOL_FAVORITES_SETTING_KEY)),
        save: (favorites) => putServerSetting(SYMBOL_FAVORITES_SETTING_KEY, favorites),
      })
    })
    return () => {
      cancelled = true
      stop?.()
    }
  }, [])
}
