import Dexie, { type Table } from 'dexie'
import type { ProjectV2 } from '@/types/projectV2'
import {
  normalizeStoredProjectToV2,
  projectToStoredProjectV2,
} from '@/lib/projectV2/migration'
import {
  deleteServerProject,
  getServerProject,
  isServerStorageEnabled,
  listServerProjects,
  putServerProject,
  ServerStorageConflictError,
  type ServerProjectMetadata,
} from './communityServerStorage'

export type ProjectStorageMode = 'local'

export interface ProjectMetadata {
  id: string
  name: string
  createdAt: string
  updatedAt: string
  lastOpened?: string
  storageMode: 'local'
}

export interface AppSettings {
  key: string
  value: unknown
}

interface ProjectAssetBlob {
  id: string
  projectId: string
  kind: string
  updatedAt: string
  bytes: Uint8Array
}

export class EendraDatabase extends Dexie {
  projects!: Table<ProjectV2, string>
  projectAssetBlobs!: Table<ProjectAssetBlob, string>
  projectMetadata!: Table<ProjectMetadata, string>
  settings!: Table<AppSettings, string>

  constructor() {
    super('ConduiCommunityDB')
    this.version(1).stores({
      projects: 'project.id, project.name, project.updatedAt',
      projectAssetBlobs: 'id, projectId, kind, updatedAt',
      projectMetadata: 'id, name, updatedAt, lastOpened',
      settings: 'key',
    })
  }
}

export const db = new EendraDatabase()

function toProjectMetadata(metadata: ServerProjectMetadata): ProjectMetadata {
  return {
    id: metadata.id,
    name: metadata.name,
    createdAt: metadata.createdAt,
    updatedAt: metadata.updatedAt,
    lastOpened: metadata.lastOpened,
    storageMode: 'local',
  }
}

function byLastOpenedDescending(left: ProjectMetadata, right: ProjectMetadata): number {
  return (right.lastOpened ?? right.updatedAt).localeCompare(left.lastOpened ?? left.updatedAt)
}

export async function saveProject(
  project: ProjectV2,
  options?: { lastOpened?: string; storageMode?: ProjectStorageMode },
): Promise<void> {
  const stored = projectToStoredProjectV2(project)
  if (await isServerStorageEnabled()) {
    await putServerProject(stored.project.id, stored, { lastOpened: options?.lastOpened })
    return
  }
  await saveBrowserProject(stored, options?.lastOpened)
}

async function saveBrowserProject(stored: ProjectV2, lastOpened?: string): Promise<void> {
  const metadata: ProjectMetadata = {
    id: stored.project.id,
    name: stored.project.name,
    createdAt: stored.project.createdAt,
    updatedAt: stored.project.updatedAt,
    lastOpened: lastOpened ?? new Date().toISOString(),
    storageMode: 'local',
  }
  await db.transaction('rw', [db.projects, db.projectMetadata], async () => {
    await db.projects.put(stored, stored.project.id)
    await db.projectMetadata.put(metadata, metadata.id)
  })
}

export async function loadProject(projectId: string): Promise<ProjectV2 | undefined> {
  if (await isServerStorageEnabled()) {
    const result = await getServerProject(projectId, { touch: true })
    return result ? normalizeStoredProjectToV2(result.project as ProjectV2) : undefined
  }
  const stored = await db.projects.get(projectId)
  if (!stored) return undefined
  await db.projectMetadata.update(projectId, { lastOpened: new Date().toISOString() })
  return normalizeStoredProjectToV2(stored)
}

export async function deleteProject(projectId: string): Promise<void> {
  if (await isServerStorageEnabled()) {
    await deleteServerProject(projectId)
    return
  }
  await deleteBrowserProject(projectId)
}

async function deleteBrowserProject(projectId: string): Promise<void> {
  await db.transaction('rw', [db.projects, db.projectAssetBlobs, db.projectMetadata], async () => {
    await db.projects.delete(projectId)
    await db.projectAssetBlobs.where('projectId').equals(projectId).delete()
    await db.projectMetadata.delete(projectId)
  })
}

export async function listProjects(): Promise<ProjectMetadata[]> {
  if (await isServerStorageEnabled()) {
    return (await listServerProjects()).map(toProjectMetadata).sort(byLastOpenedDescending)
  }
  return listBrowserProjects()
}

function listBrowserProjects(): Promise<ProjectMetadata[]> {
  return db.projectMetadata.orderBy('lastOpened').reverse().toArray()
}

export async function getRecentProjects(limit = 50): Promise<ProjectMetadata[]> {
  return (await listProjects()).slice(0, limit)
}

export async function getCachedRecentProjects(limit = 50): Promise<ProjectMetadata[]> {
  return getRecentProjects(limit)
}

export async function getProjectMetadataById(projectId: string): Promise<ProjectMetadata | undefined> {
  if (await isServerStorageEnabled()) {
    return (await listProjects()).find((project) => project.id === projectId)
  }
  return db.projectMetadata.get(projectId)
}

export async function getProjectRemoteRevision(projectId: string): Promise<string | undefined> {
  return (await getProjectMetadataById(projectId))?.updatedAt
}

/** Projects still kept in this browser while the server stores projects. */
export async function listBrowserOnlyProjects(): Promise<ProjectMetadata[]> {
  if (!(await isServerStorageEnabled())) return []
  return listBrowserProjects()
}

/**
 * Copies this browser's projects to the server and removes the browser copies that arrived.
 * A project the server already has is left untouched on both sides.
 */
export async function moveBrowserProjectsToServer(): Promise<{ moved: number; skipped: number }> {
  let moved = 0
  let skipped = 0
  for (const metadata of await listBrowserProjects()) {
    const stored = await db.projects.get(metadata.id)
    if (!stored) continue
    try {
      await putServerProject(metadata.id, stored, { lastOpened: metadata.lastOpened, createOnly: true })
    } catch (error) {
      if (error instanceof ServerStorageConflictError) {
        skipped += 1
        continue
      }
      throw error
    }
    await deleteBrowserProject(metadata.id)
    moved += 1
  }
  return { moved, skipped }
}

export async function prepareProjectForCloudMove(project: ProjectV2): Promise<ProjectV2> {
  return project
}

export async function adoptUnscopedLocalProjectsForUser(_userId: string): Promise<void> {}

export function isProjectStorageModeAvailable(mode: string): mode is ProjectStorageMode {
  return mode === 'local'
}
