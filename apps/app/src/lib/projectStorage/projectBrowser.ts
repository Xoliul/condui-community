import type { ProjectMetadata } from './types'

export const PROJECT_BROWSER_PAGE_SIZE = 25
export type ProjectBrowserQuery = { search: string; limit: number }

/** Browsing uses metadata, independently of drawing loads and offline prefetch. */
export function selectProjectBrowserPage(projects: ProjectMetadata[], query: ProjectBrowserQuery) {
  const search = query.search.trim().toLocaleLowerCase()
  return projects.filter((project) => !search || project.name.toLocaleLowerCase().includes(search))
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || a.id.localeCompare(b.id))
    .slice(0, query.limit)
}
