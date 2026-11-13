import { useDeferredValue, useMemo, useState } from 'react'
import { PROJECT_BROWSER_PAGE_SIZE } from '@/lib/projectStorage/projectBrowser'

export function useProjectBrowserQuery() {
  const [search, setSearch] = useState('')
  const [visibleLimit, setVisibleLimit] = useState(PROJECT_BROWSER_PAGE_SIZE)
  const deferredSearch = useDeferredValue(search)
  const query = useMemo(() => ({ search: deferredSearch, limit: visibleLimit + 1 }), [deferredSearch, visibleLimit])
  return { search, visibleLimit, query,
    changeSearch: (value: string) => { setSearch(value); setVisibleLimit(PROJECT_BROWSER_PAGE_SIZE) },
    loadMore: () => setVisibleLimit((limit) => limit + PROJECT_BROWSER_PAGE_SIZE),
  }
}

