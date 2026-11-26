import { StorageError } from './storage.mjs'

// MCP endpoint and its settings API for the Community server. The service itself is TypeScript
// bundled by `scripts/build-community-mcp.mjs` (part of `npm run build:community`); it edits the
// same project documents as the editor through the storage below.

const MAX_MCP_BODY_BYTES = 1024 * 1024
const MAX_SETTINGS_BODY_BYTES = 4 * 1024

function sendJson(response, statusCode, value) {
  response.writeHead(statusCode, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' })
  response.end(JSON.stringify(value))
}

async function readBody(request, limit) {
  const chunks = []
  let size = 0
  for await (const chunk of request) {
    size += chunk.length
    if (size > limit) return null
    chunks.push(Buffer.from(chunk))
  }
  return Buffer.concat(chunks)
}

function storedProjectBackend(storage) {
  return {
    async list() {
      const projects = await storage.listProjects()
      return projects.map(({ id, name, updatedAt, revision }) => ({ id, name, updatedAt, revision }))
    },
    async get(id) {
      try {
        const { project, metadata } = await storage.getProject(id)
        return { project, revision: metadata.revision }
      } catch (error) {
        if (error instanceof StorageError && error.statusCode === 404) return undefined
        throw error
      }
    },
    async put(id, project, baseRevision) {
      try {
        const metadata = await storage.putProject(id, { project, baseRevision })
        return { ok: true, revision: metadata.revision }
      } catch (error) {
        if (error instanceof StorageError && error.statusCode === 409)
          return { ok: false, revision: error.details?.revision ?? null }
        throw error
      }
    },
    readAccess: () => storage.getMcpAccess(),
    writeAccess: (access) => storage.putMcpAccess(access),
  }
}

function requestOrigin(request) {
  const forwarded = String(request.headers['x-forwarded-proto'] ?? '').split(',')[0].trim()
  const protocol = forwarded === 'https' || forwarded === 'http' ? forwarded : 'http'
  return `${protocol}://${request.headers.host ?? 'localhost'}`
}

/** Returns route handlers; each returns false for paths it does not own. */
export function createMcpRoutes(storage, log = console) {
  let servicePromise = null
  const loadService = () => {
    servicePromise ??= import('./mcp/service.bundle.mjs')
      .then(({ createCommunityMcpService }) => createCommunityMcpService(storedProjectBackend(storage)))
      .catch((error) => {
        servicePromise = null
        log.error('MCP is unavailable: run `npm run build:community` to build community/mcp/service.bundle.mjs.', error)
        return null
      })
    return servicePromise
  }

  /** `/mcp`: bearer token only, so it runs before the editor's password gate. */
  async function handleMcp(request, response, pathname) {
    if (pathname !== '/mcp') return false
    if (!storage) {
      sendJson(response, 404, { error: 'MCP needs server storage. Map a folder to /data.' })
      return true
    }
    const service = await loadService()
    if (!service) {
      sendJson(response, 503, { error: 'MCP is not built on this server.' })
      return true
    }
    const method = request.method ?? 'GET'
    const body = method === 'POST' ? await readBody(request, MAX_MCP_BODY_BYTES) : undefined
    if (body === null) {
      sendJson(response, 413, { error: 'Request is too large.' })
      return true
    }
    const headers = new Headers()
    for (const [name, value] of Object.entries(request.headers)) {
      if (value !== undefined) headers.set(name, Array.isArray(value) ? value.join(', ') : value)
    }
    const fetchRequest = new Request(`${requestOrigin(request)}/mcp`, { method, headers, body })
    let result
    try {
      result = await service.handle(fetchRequest)
    } catch (error) {
      log.error('MCP request failed:', error)
      sendJson(response, 500, { error: 'MCP request failed.' })
      return true
    }
    response.writeHead(result.status, Object.fromEntries(result.headers))
    response.end(Buffer.from(await result.arrayBuffer()))
    return true
  }

  /** `/api/mcp/settings`: behind the password gate; the editor's Settings panel manages the token. */
  async function handleSettings(request, response, pathname) {
    if (pathname !== '/api/mcp/settings') return false
    const method = request.method ?? 'GET'
    if (!storage) {
      sendJson(response, 200, { available: false })
      return true
    }
    const service = await loadService()
    if (!service) {
      sendJson(response, 503, { error: 'MCP is not built on this server.' })
      return true
    }
    if (method === 'GET') {
      sendJson(response, 200, { available: true, ...(await service.status()) })
      return true
    }
    if (method !== 'POST') {
      sendJson(response, 405, { error: 'Method not allowed.' })
      return true
    }
    // JSON only, and same origin when a browser says where it came from: another site cannot
    // send this without a CORS preflight, which the server never answers.
    const contentType = String(request.headers['content-type'] ?? '').split(';')[0].trim().toLowerCase()
    const origin = request.headers.origin
    if (contentType !== 'application/json' || (origin !== undefined && origin !== requestOrigin(request))) {
      sendJson(response, 403, { error: 'Forbidden.' })
      return true
    }
    const raw = await readBody(request, MAX_SETTINGS_BODY_BYTES)
    let action
    try {
      action = raw === null ? undefined : JSON.parse(raw.toString('utf8'))?.action
    } catch {
      action = undefined
    }
    if (action !== 'create' && action !== 'disable') {
      sendJson(response, 400, { error: 'Unknown action.' })
      return true
    }
    try {
      sendJson(response, 200, { available: true, ...(await service.runAction(action)) })
    } catch (error) {
      log.error('MCP settings change failed:', error)
      sendJson(response, 500, { error: 'MCP settings could not be saved.' })
    }
    return true
  }

  return { handleMcp, handleSettings }
}
