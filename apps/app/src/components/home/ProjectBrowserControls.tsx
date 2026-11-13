import { useTranslation } from 'react-i18next'
import type { useProjectBrowserQuery } from '@/hooks/useProjectBrowserQuery'
import type { ProjectBrowserQuery } from '@/lib/projectStorage/projectBrowser'

type Browser = ReturnType<typeof useProjectBrowserQuery>
export function ProjectBrowserSearch({ browser, count, query }: {
  browser: Browser
  count: number
  query?: ProjectBrowserQuery
}) {
  const { t } = useTranslation()
  const hasMoreProjects = query && count >= query.limit
  // Keep the field mounted until clearing a search has restored the unfiltered page.
  if (!browser.search && !query?.search && !hasMoreProjects) return null
  return (
    <div className="mb-4 flex justify-end">
      <input
        type="search"
        value={browser.search}
        onChange={(event) => browser.changeSearch(event.target.value)}
        aria-label={t('project.searchProjects')}
        placeholder={t('project.searchProjects')}
        className="w-full max-w-64 rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
      />
    </div>
  )
}

export function ProjectBrowserLoadMore({ browser, count, loading }: { browser: Browser; count: number; loading: boolean }) {
  const { t } = useTranslation()
  if (count <= browser.visibleLimit) return null
  return <div className="mt-4 flex justify-center"><button type="button" onClick={browser.loadMore} disabled={loading}
    className="rounded-md border border-slate-300 px-4 py-2 text-sm font-medium text-slate-800 disabled:opacity-50 dark:border-slate-600 dark:text-slate-100">
    {t('project.loadMore')}
  </button></div>
}
