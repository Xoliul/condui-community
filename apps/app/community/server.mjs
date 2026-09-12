import { createServer } from 'node:http'
import { createReadStream, existsSync, statSync } from 'node:fs'
import { extname, join, normalize } from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
const communityRoot = fileURLToPath(new URL('.', import.meta.url))
const distRoot = normalize(join(communityRoot, '..', 'dist'))
const port = Number.parseInt(process.env.PORT ?? '8080', 10)
const host = process.env.HOST ?? '127.0.0.1'
if (!host) {
  console.error('HOST must not be empty (use 127.0.0.1, localhost, 0.0.0.0, or an explicit IP).')
  process.exit(1)
}

const conversionHandlers = new Map([
  ['/api/convert-pdf', '../netlify/functions-offline/convert-pdf.cjs'],
  ['/api/convert-dxf', '../netlify/functions-offline/convert-dxf.cjs'],
  ['/api/convert-dwg', '../netlify/functions-offline/convert-dwg.cjs'],
])

const mimeTypes = new Map([
  ['.css', 'text/css; charset=utf-8'],
  ['.html', 'text/html; charset=utf-8'],
  ['.ico', 'image/x-icon'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8'],
  ['.mjs', 'text/javascript; charset=utf-8'],
  ['.png', 'image/png'],
  ['.svg', 'image/svg+xml'],
  ['.ttf', 'font/ttf'],
  ['.wasm', 'application/wasm'],
  ['.webmanifest', 'application/manifest+json'],
  ['.woff', 'font/woff'],
  ['.woff2', 'font/woff2'],
])

async function readBody(request) {
  const chunks = []
  for await (const chunk of request) chunks.push(Buffer.from(chunk))
  return Buffer.concat(chunks)
}

function sendJson(response, statusCode, value) {
  response.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  })
  response.end(JSON.stringify(value))
}

async function runConversion(request, response, modulePath) {
  if (request.method !== 'POST') {
    sendJson(response, 405, { error: 'Method not allowed' })
    return
  }

  try {
    const rawBody = await readBody(request)
    const moduleUrl = new URL(modulePath, import.meta.url)
    const handlerModule = require(fileURLToPath(moduleUrl))
    const result = await handlerModule.handler({
      httpMethod: 'POST',
      headers: request.headers,
      body: rawBody.toString('base64'),
      isBase64Encoded: true,
      rawUrl: request.url ?? '',
    })
    response.writeHead(result?.statusCode ?? 200, {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      ...(result?.headers ?? {}),
    })
    const responseBody = result?.body ?? ''
    response.end(result?.isBase64Encoded ? Buffer.from(responseBody, 'base64') : responseBody)
  } catch (error) {
    sendJson(response, 500, {
      error: error instanceof Error ? error.message : 'Local conversion failed.',
    })
  }
}

function safeStaticPath(pathname) {
  let decoded
  try {
    decoded = decodeURIComponent(pathname)
  } catch {
    return null
  }
  const relative = normalize(decoded.replace(/^\/+/, ''))
  if (!relative || relative === '.') return join(distRoot, 'index.html')
  if (relative.startsWith('..') || relative.includes(`..${process.platform === 'win32' ? '\\' : '/'}`)) {
    return null
  }
  const candidate = join(distRoot, relative)
  if (!candidate.startsWith(distRoot)) return null
  return candidate
}

function serveFile(response, filePath) {
  const extension = extname(filePath).toLowerCase()
  const immutable = filePath.includes(`${process.platform === 'win32' ? '\\' : '/'}assets${process.platform === 'win32' ? '\\' : '/'}`)
  response.writeHead(200, {
    'Content-Type': mimeTypes.get(extension) ?? 'application/octet-stream',
    'Cache-Control': immutable ? 'public, max-age=31536000, immutable' : 'no-cache',
    'X-Content-Type-Options': 'nosniff',
  })
  createReadStream(filePath).pipe(response)
}

const server = createServer(async (request, response) => {
  const url = new URL(request.url ?? '/', `http://${request.headers.host ?? 'localhost'}`)
  if (url.pathname === '/healthz') {
    sendJson(response, 200, { ok: true, edition: 'community' })
    return
  }

  const conversionModule = conversionHandlers.get(url.pathname)
  if (conversionModule) {
    await runConversion(request, response, conversionModule)
    return
  }

  if (url.pathname.startsWith('/api/')) {
    sendJson(response, 404, { error: 'API route not available in the community edition.' })
    return
  }

  const filePath = safeStaticPath(url.pathname)
  if (!filePath) {
    sendJson(response, 400, { error: 'Invalid path.' })
    return
  }

  if (existsSync(filePath) && statSync(filePath).isFile()) {
    serveFile(response, filePath)
    return
  }
  serveFile(response, join(distRoot, 'index.html'))
})

server.listen(port, host, () => {
  console.log(`Condui Community listening on http://${host}:${port}`)
})
