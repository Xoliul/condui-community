import { constants, promises as fs, accessSync, statSync } from 'node:fs'
import { join } from 'node:path'

// Optional server-side project storage. It is active only when the data directory exists, which in
// Docker means the user mapped a volume to /data. Projects are plain JSON files that can be copied
// for backups; the small `.meta.json` sidecar keeps the project list cheap to read.

const PROJECT_ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/
const SETTING_KEY_PATTERN = /^[A-Za-z0-9_.:-]{1,128}$/

export const MAX_PROJECT_BYTES = 512 * 1024 * 1024
export const MAX_SETTINGS_BYTES = 32 * 1024 * 1024

export class StorageError extends Error {
  constructor(statusCode, message, details = {}) {
    super(message)
    this.statusCode = statusCode
    this.details = details
  }
}

export function resolveDataDirectory(env = process.env) {
  return env.CONDUI_DATA_DIR?.trim() || '/data'
}

/** Returns a storage instance, or null when no data directory is available. */
export function openStorage(dataDirectory, log = console) {
  let stats
  try {
    stats = statSync(dataDirectory)
  } catch {
    return null
  }
  if (!stats.isDirectory()) {
    log.error(`Server storage disabled: ${dataDirectory} is not a directory.`)
    return null
  }
  try {
    accessSync(dataDirectory, constants.R_OK | constants.W_OK)
  } catch {
    log.error(`Server storage disabled: ${dataDirectory} is not writable.`)
    return null
  }
  return createStorage(dataDirectory)
}

function assertProjectId(id) {
  if (typeof id !== 'string' || !PROJECT_ID_PATTERN.test(id)) throw new StorageError(400, 'Invalid project id.')
}

function assertSettingKey(key) {
  if (typeof key !== 'string' || !SETTING_KEY_PATTERN.test(key)) throw new StorageError(400, 'Invalid setting key.')
}

function isNotFound(error) {
  return error && typeof error === 'object' && error.code === 'ENOENT'
}

async function readJson(path) {
  try {
    return JSON.parse(await fs.readFile(path, 'utf8'))
  } catch (error) {
    if (isNotFound(error)) return undefined
    throw error
  }
}

async function writeJsonAtomically(path, value) {
  const temporaryPath = `${path}.${process.pid}.${Date.now()}.tmp`
  await fs.writeFile(temporaryPath, JSON.stringify(value), 'utf8')
  await fs.rename(temporaryPath, path)
}

function metadataFor(storedProject, previous, lastOpened) {
  const project = storedProject?.project
  if (!project || typeof project !== 'object') throw new StorageError(400, 'Missing project data.')
  const now = new Date().toISOString()
  return {
    id: project.id,
    name: typeof project.name === 'string' ? project.name : '',
    createdAt: typeof project.createdAt === 'string' ? project.createdAt : (previous?.createdAt ?? now),
    updatedAt: typeof project.updatedAt === 'string' ? project.updatedAt : now,
    lastOpened: lastOpened ?? previous?.lastOpened ?? now,
    revision: (previous?.revision ?? 0) + 1,
  }
}

export function createStorage(dataDirectory) {
  const projectsDirectory = join(dataDirectory, 'projects')
  const settingsPath = join(dataDirectory, 'settings.json')
  const projectPath = (id) => join(projectsDirectory, `${id}.json`)
  const metadataPath = (id) => join(projectsDirectory, `${id}.meta.json`)

  // One writer at a time keeps revisions and settings.json consistent without file locks.
  let queue = Promise.resolve()
  const serialized = (task) => {
    const run = queue.catch(() => undefined).then(task)
    queue = run
    return run
  }

  const ready = fs.mkdir(projectsDirectory, { recursive: true })

  async function readMetadata(id) {
    const metadata = await readJson(metadataPath(id))
    if (metadata) return metadata
    // Rebuild a missing sidecar, e.g. after a project file was copied in by hand.
    const project = await readJson(projectPath(id))
    if (!project) return undefined
    const rebuilt = { ...metadataFor(project, undefined, undefined), id }
    await writeJsonAtomically(metadataPath(id), rebuilt)
    return rebuilt
  }

  async function listProjects() {
    await ready
    const names = await fs.readdir(projectsDirectory)
    const ids = names
      .filter((name) => name.endsWith('.json') && !name.endsWith('.meta.json'))
      .map((name) => name.slice(0, -'.json'.length))
      .filter((id) => PROJECT_ID_PATTERN.test(id))
    const metadata = await Promise.all(ids.map((id) => readMetadata(id).catch(() => undefined)))
    return metadata.filter(Boolean)
  }

  async function getProject(id, { touch = false } = {}) {
    assertProjectId(id)
    await ready
    const project = await readJson(projectPath(id))
    if (!project) throw new StorageError(404, 'Project not found.')
    let metadata = await readMetadata(id)
    if (touch) {
      metadata = await serialized(async () => {
        const current = (await readMetadata(id)) ?? metadata
        const next = { ...current, lastOpened: new Date().toISOString() }
        await writeJsonAtomically(metadataPath(id), next)
        return next
      })
    }
    return { project, metadata }
  }

  function putProject(id, { project, baseRevision = null, force = false, lastOpened }) {
    assertProjectId(id)
    if (project?.project?.id !== id) throw new StorageError(400, 'Project id does not match.')
    return serialized(async () => {
      await ready
      const previous = await readMetadata(id)
      if (!force) {
        if (baseRevision === null && previous) {
          throw new StorageError(409, 'Project already exists.', { revision: previous.revision })
        }
        if (baseRevision !== null && previous?.revision !== baseRevision) {
          throw new StorageError(409, 'Project was changed elsewhere.', { revision: previous?.revision ?? null })
        }
      }
      const metadata = metadataFor(project, previous, typeof lastOpened === 'string' ? lastOpened : undefined)
      await writeJsonAtomically(projectPath(id), project)
      await writeJsonAtomically(metadataPath(id), metadata)
      return metadata
    })
  }

  function deleteProject(id) {
    assertProjectId(id)
    return serialized(async () => {
      await ready
      await fs.rm(projectPath(id), { force: true })
      await fs.rm(metadataPath(id), { force: true })
    })
  }

  async function getSetting(key) {
    assertSettingKey(key)
    const settings = (await readJson(settingsPath)) ?? {}
    return Object.prototype.hasOwnProperty.call(settings, key) ? settings[key] : undefined
  }

  function putSetting(key, value) {
    assertSettingKey(key)
    return serialized(async () => {
      const settings = (await readJson(settingsPath)) ?? {}
      if (value === null || value === undefined) delete settings[key]
      else settings[key] = value
      await writeJsonAtomically(settingsPath, settings)
    })
  }

  return { listProjects, getProject, putProject, deleteProject, getSetting, putSetting }
}

async function readBody(request, limit) {
  const chunks = []
  let size = 0
  for await (const chunk of request) {
    size += chunk.length
    if (size > limit) throw new StorageError(413, 'Request is too large.')
    chunks.push(Buffer.from(chunk))
  }
  return Buffer.concat(chunks)
}

async function readJsonBody(request, limit) {
  const body = await readBody(request, limit)
  try {
    return JSON.parse(body.toString('utf8'))
  } catch {
    throw new StorageError(400, 'Request body is not valid JSON.')
  }
}

function sendJson(response, statusCode, value) {
  response.writeHead(statusCode, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' })
  response.end(JSON.stringify(value))
}

/** Handles `/api/storage/...`; returns false for other paths. */
export async function handleStorageRequest(storage, request, response, pathname) {
  if (pathname !== '/api/storage' && !pathname.startsWith('/api/storage/')) return false
  const method = request.method ?? 'GET'
  try {
    if (pathname === '/api/storage') {
      if (method !== 'GET') throw new StorageError(405, 'Method not allowed.')
      sendJson(response, 200, { enabled: Boolean(storage) })
      return true
    }
    if (!storage) throw new StorageError(404, 'Server storage is not enabled.')

    const segments = pathname.split('/').slice(3).map((segment) => {
      try {
        return decodeURIComponent(segment)
      } catch {
        throw new StorageError(400, 'Invalid path.')
      }
    })
    const [collection, id, ...rest] = segments
    if (rest.length > 0) throw new StorageError(404, 'Not found.')

    if (collection === 'projects' && id === undefined) {
      if (method !== 'GET') throw new StorageError(405, 'Method not allowed.')
      sendJson(response, 200, { projects: await storage.listProjects() })
      return true
    }
    if (collection === 'projects') {
      if (method === 'GET') {
        const touch = new URL(request.url ?? '', 'http://localhost').searchParams.get('touch') === '1'
        sendJson(response, 200, await storage.getProject(id, { touch }))
      } else if (method === 'PUT') {
        const body = await readJsonBody(request, MAX_PROJECT_BYTES)
        const metadata = await storage.putProject(id, {
          project: body?.project,
          baseRevision: Number.isInteger(body?.baseRevision) ? body.baseRevision : null,
          force: body?.force === true,
          lastOpened: body?.lastOpened,
        })
        sendJson(response, 200, { metadata })
      } else if (method === 'DELETE') {
        await storage.deleteProject(id)
        response.writeHead(204, { 'Cache-Control': 'no-store' })
        response.end()
      } else {
        throw new StorageError(405, 'Method not allowed.')
      }
      return true
    }
    if (collection === 'settings' && id !== undefined) {
      if (method === 'GET') {
        const value = await storage.getSetting(id)
        sendJson(response, value === undefined ? 404 : 200, { value: value ?? null })
      } else if (method === 'PUT') {
        const body = await readJsonBody(request, MAX_SETTINGS_BYTES)
        await storage.putSetting(id, body?.value)
        sendJson(response, 200, { ok: true })
      } else {
        throw new StorageError(405, 'Method not allowed.')
      }
      return true
    }
    throw new StorageError(404, 'Not found.')
  } catch (error) {
    if (error instanceof StorageError) {
      sendJson(response, error.statusCode, { error: error.message, ...error.details })
    } else {
      console.error('Server storage request failed:', error)
      sendJson(response, 500, { error: 'Server storage failed.' })
    }
    return true
  }
}
