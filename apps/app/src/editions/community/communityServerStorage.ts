/**
 * Client for the optional Community server storage (`apps/app/community/storage.mjs`). The server
 * enables it when a data folder is mapped; otherwise every call site keeps using browser storage.
 */

export interface ServerProjectMetadata {
  id: string
  name: string
  createdAt: string
  updatedAt: string
  lastOpened?: string
  revision: number
}

export const SERVER_STORAGE_CONFLICT_EVENT = 'condui-community:storage-conflict'

export type ServerStorageConflictDetail = { projectId: string }

export class ServerStorageConflictError extends Error {
  constructor(readonly projectId: string) {
    super('The project was changed on another device.')
    this.name = 'ServerStorageConflictError'
  }
}

const API_ROOT = '/api/storage'

let enabledPromise: Promise<boolean> | null = null
// Revision of each project as this browser last read or wrote it; saves are rejected when the
// server holds a newer one, so two devices cannot silently overwrite each other.
const knownRevisions = new Map<string, number>()
const conflictedProjects = new Set<string>()
const forcedProjects = new Set<string>()

export function isServerStorageEnabled(): Promise<boolean> {
  enabledPromise ??= fetch(API_ROOT, { cache: 'no-store', headers: { Accept: 'application/json' } })
    .then(async (response) => {
      if (!response.ok) return false
      const body = (await response.json()) as { enabled?: unknown }
      return body.enabled === true
    })
    .catch(() => false)
  return enabledPromise
}

export function resetServerStorageStateForTests(): void {
  enabledPromise = null
  knownRevisions.clear()
  conflictedProjects.clear()
  forcedProjects.clear()
}

async function request<T>(path: string, init?: RequestInit): Promise<{ status: number; body: T }> {
  const response = await fetch(`${API_ROOT}${path}`, {
    cache: 'no-store',
    ...init,
    headers: { Accept: 'application/json', ...(init?.body ? { 'Content-Type': 'application/json' } : {}) },
  })
  const text = response.status === 204 ? '' : await response.text()
  const body = (text ? JSON.parse(text) : null) as T
  if (!response.ok && response.status !== 404 && response.status !== 409) {
    const message = (body as { error?: string } | null)?.error ?? `Server storage failed (${response.status}).`
    throw new Error(message)
  }
  return { status: response.status, body }
}

const projectPath = (id: string) => `/projects/${encodeURIComponent(id)}`

export async function listServerProjects(): Promise<ServerProjectMetadata[]> {
  const { body } = await request<{ projects: ServerProjectMetadata[] }>('/projects')
  return body.projects
}

export async function getServerProject(
  id: string,
  options: { touch?: boolean } = {},
): Promise<{ project: unknown; metadata: ServerProjectMetadata } | undefined> {
  const { status, body } = await request<{ project: unknown; metadata: ServerProjectMetadata }>(
    `${projectPath(id)}${options.touch ? '?touch=1' : ''}`,
  )
  if (status === 404) return undefined
  knownRevisions.set(id, body.metadata.revision)
  conflictedProjects.delete(id)
  return body
}

/**
 * Saves a project. A new project (no known revision) may not replace an existing one; an open
 * project may only replace the revision it was loaded from, unless the user chose to overwrite.
 */
export async function putServerProject(
  id: string,
  project: unknown,
  options: { lastOpened?: string; createOnly?: boolean } = {},
): Promise<ServerProjectMetadata> {
  if (conflictedProjects.has(id)) throw new ServerStorageConflictError(id)
  const force = forcedProjects.has(id) && !options.createOnly
  const { status, body } = await request<{ metadata: ServerProjectMetadata }>(projectPath(id), {
    method: 'PUT',
    body: JSON.stringify({
      project,
      baseRevision: options.createOnly ? null : (knownRevisions.get(id) ?? null),
      force,
      lastOpened: options.lastOpened,
    }),
  })
  if (status === 409) {
    if (!options.createOnly) {
      conflictedProjects.add(id)
      window.dispatchEvent(
        new CustomEvent<ServerStorageConflictDetail>(SERVER_STORAGE_CONFLICT_EVENT, { detail: { projectId: id } }),
      )
    }
    throw new ServerStorageConflictError(id)
  }
  forcedProjects.delete(id)
  knownRevisions.set(id, body.metadata.revision)
  return body.metadata
}

/** Lets the next save replace the newer version on the server. */
export function overwriteServerProjectOnNextSave(id: string): void {
  conflictedProjects.delete(id)
  forcedProjects.add(id)
}

export async function deleteServerProject(id: string): Promise<void> {
  await request(projectPath(id), { method: 'DELETE' })
  knownRevisions.delete(id)
  conflictedProjects.delete(id)
  forcedProjects.delete(id)
}

export async function getServerSetting<T>(key: string): Promise<T | undefined> {
  const { status, body } = await request<{ value: T }>(`/settings/${encodeURIComponent(key)}`)
  return status === 404 ? undefined : body.value
}

export async function putServerSetting(key: string, value: unknown): Promise<void> {
  await request(`/settings/${encodeURIComponent(key)}`, { method: 'PUT', body: JSON.stringify({ value }) })
}
