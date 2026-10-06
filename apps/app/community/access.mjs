import { createHash, timingSafeEqual } from 'node:crypto'
import { BlockList, isIP } from 'node:net'
import { networkInterfaces } from 'node:os'
import { PUBLIC_TOP_LEVEL_DOMAINS } from './publicTlds.mjs'

// Community is a single-user tool for one's own network. Without CONDUI_PASSWORD it only answers
// devices on that network; with a password, every request needs it and access from anywhere is allowed.

const privateNetworks = new BlockList()
for (const [network, prefix] of [
  ['10.0.0.0', 8],
  ['172.16.0.0', 12],
  ['192.168.0.0', 16],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  // Carrier-grade NAT space, used by Tailscale and similar private overlays.
  ['100.64.0.0', 10],
]) {
  privateNetworks.addSubnet(network, prefix, 'ipv4')
}
for (const [network, prefix] of [
  ['::1', 128],
  ['fc00::', 7],
  ['fe80::', 10],
]) {
  privateNetworks.addSubnet(network, prefix, 'ipv6')
}

const MIN_PASSWORD_LENGTH = 8
const REJECTED_PASSWORDS = new Set([
  'changeme',
  'choose-your-own-password',
  'password',
  'wachtwoord',
  'motdepasse',
  '12345678',
])
const FAILED_LOGIN_WINDOW_MS = 10 * 60 * 1000
const FAILED_LOGIN_LIMIT = 10

function stripIpv4Mapping(address) {
  const match = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(address)
  return match ? match[1] : address
}

/** Normalizes an address from a socket or a proxy header; returns null when it is not an IP. */
export function normalizeAddress(raw) {
  if (typeof raw !== 'string') return null
  let value = raw.trim().replace(/^"|"$/g, '')
  if (!value || value.toLowerCase() === 'unknown') return null
  const bracketed = /^\[([^\]]+)\](?::\d+)?$/.exec(value)
  if (bracketed) value = bracketed[1]
  else if (/^\d+\.\d+\.\d+\.\d+:\d+$/.test(value)) value = value.slice(0, value.lastIndexOf(':'))
  value = stripIpv4Mapping(value.replace(/%.*$/, ''))
  return isIP(value) ? value : null
}

export function isPrivateAddress(address) {
  const normalized = normalizeAddress(address)
  if (!normalized) return false
  return privateNetworks.check(normalized, isIP(normalized) === 6 ? 'ipv6' : 'ipv4')
}

/** Client addresses that a reverse proxy or tunnel passed along. They can only make access stricter. */
export function forwardedClientAddresses(headers) {
  const values = []
  const add = (raw) => {
    const address = normalizeAddress(raw)
    if (address) values.push(address)
  }
  const header = (name) => {
    const value = headers[name]
    return Array.isArray(value) ? value.join(',') : value
  }
  for (const part of (header('x-forwarded-for') ?? '').split(',')) add(part)
  for (const name of ['x-real-ip', 'cf-connecting-ip', 'true-client-ip', 'fly-client-ip']) add(header(name))
  for (const match of (header('forwarded') ?? '').matchAll(/for=("[^"]*"|[^;,\s]+)/gi)) add(match[1])
  return values
}

function hostNameFromHeader(host) {
  if (typeof host !== 'string') return ''
  const value = host.trim().toLowerCase()
  const bracketed = /^\[([^\]]+)\](?::\d+)?$/.exec(value)
  if (bracketed) return bracketed[1]
  if (isIP(value) === 6) return value
  return value.replace(/:\d+$/, '').replace(/\.$/, '')
}

/** Whether the address typed in the browser can only point inside the user's own network. */
export function isLocalHostName(host) {
  const name = hostNameFromHeader(host)
  if (!name) return false
  if (isIP(name)) return isPrivateAddress(name)
  if (!name.includes('.')) return true
  if (name === 'localhost' || name.endsWith('.localhost') || name.endsWith('.home.arpa')) return true
  const topLevelDomain = name.slice(name.lastIndexOf('.') + 1)
  return !PUBLIC_TOP_LEVEL_DOMAINS.has(topLevelDomain)
}

/**
 * Subnets this server is attached to. A connection from inside them may be relayed by Docker
 * (Docker Desktop, rootless Docker) or a local proxy, so its address says nothing about the visitor.
 */
export function localSubnets(interfaces = networkInterfaces()) {
  const subnets = new BlockList()
  for (const entries of Object.values(interfaces)) {
    for (const entry of entries ?? []) {
      const [network, prefix] = (entry.cidr ?? '').split('/')
      const family = entry.family === 'IPv6' || entry.family === 6 ? 'ipv6' : 'ipv4'
      if (network && prefix) subnets.addSubnet(network, Number(prefix), family)
    }
  }
  subnets.addSubnet('127.0.0.0', 8, 'ipv4')
  subnets.addSubnet('::1', 128, 'ipv6')
  return subnets
}

function isInSubnets(subnets, address) {
  const normalized = normalizeAddress(address)
  if (!normalized) return false
  return subnets.check(normalized, isIP(normalized) === 6 ? 'ipv6' : 'ipv4')
}

/** Whether a request without a password comes from the user's own network. */
export function isRequestFromOwnNetwork({ remoteAddress, headers, subnets }) {
  if (!isPrivateAddress(remoteAddress)) return false
  if (forwardedClientAddresses(headers).some((address) => !isPrivateAddress(address))) return false
  if (isInSubnets(subnets, remoteAddress)) return isLocalHostName(headers.host)
  return true
}

export function validateConfiguredPassword(password) {
  if (password === undefined || password === '') return { ok: true, password: null }
  if (password.length < MIN_PASSWORD_LENGTH) {
    return { ok: false, reason: `CONDUI_PASSWORD must be at least ${MIN_PASSWORD_LENGTH} characters.` }
  }
  if (REJECTED_PASSWORDS.has(password.toLowerCase())) {
    return { ok: false, reason: 'CONDUI_PASSWORD is a well-known example value. Choose your own password.' }
  }
  return { ok: true, password }
}

function digest(value) {
  return createHash('sha256').update(value, 'utf8').digest()
}

export function passwordFromAuthorization(header) {
  if (typeof header !== 'string') return null
  const match = /^Basic\s+([A-Za-z0-9+/=]+)\s*$/i.exec(header)
  if (!match) return null
  const decoded = Buffer.from(match[1], 'base64').toString('utf8')
  const separator = decoded.indexOf(':')
  return separator === -1 ? null : decoded.slice(separator + 1)
}

export function createAccessGuard({ password, subnets = localSubnets(), now = () => Date.now() }) {
  const expected = password ? digest(password) : null
  const failures = new Map()

  const recentFailures = (address) => {
    const entry = failures.get(address)
    if (!entry || now() - entry.since > FAILED_LOGIN_WINDOW_MS) {
      failures.delete(address)
      return null
    }
    return entry
  }

  /** @returns {'allow' | 'login' | 'locked' | 'outside-network'} */
  function check(request) {
    const remoteAddress = request.socket?.remoteAddress ?? ''
    if (!expected) {
      return isRequestFromOwnNetwork({ remoteAddress, headers: request.headers, subnets })
        ? 'allow'
        : 'outside-network'
    }
    const failure = recentFailures(remoteAddress)
    if (failure && failure.count >= FAILED_LOGIN_LIMIT) return 'locked'
    const supplied = passwordFromAuthorization(request.headers.authorization)
    if (supplied !== null && timingSafeEqual(digest(supplied), expected)) {
      failures.delete(remoteAddress)
      return 'allow'
    }
    if (supplied !== null) {
      failures.set(remoteAddress, { since: failure?.since ?? now(), count: (failure?.count ?? 0) + 1 })
    }
    return 'login'
  }

  return { check, requiresPassword: Boolean(expected) }
}

const outsideNetworkPage = `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Condui Community</title>
<style>body{font-family:system-ui,sans-serif;max-width:36rem;margin:15vh auto;padding:0 1rem;color:#0f172a}p{line-height:1.5}code{background:#e2e8f0;padding:.1rem .3rem;border-radius:.25rem}</style></head>
<body>
<h1>Condui Community</h1>
<p>This installation only answers devices on its own network. Set <code>CONDUI_PASSWORD</code> to allow access from elsewhere.</p>
<p lang="nl">Deze installatie antwoordt enkel op toestellen in het eigen netwerk. Stel <code>CONDUI_PASSWORD</code> in om toegang van elders toe te laten.</p>
<p lang="fr">Cette installation ne répond qu'aux appareils de son propre réseau. Définissez <code>CONDUI_PASSWORD</code> pour autoriser l'accès depuis ailleurs.</p>
</body>
</html>`

export function sendAccessDenied(response, outcome) {
  if (outcome === 'outside-network') {
    response.writeHead(403, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' })
    response.end(outsideNetworkPage)
    return
  }
  if (outcome === 'locked') {
    response.writeHead(429, { 'Content-Type': 'text/plain; charset=utf-8', 'Retry-After': '600' })
    response.end('Too many failed sign-in attempts. Try again later.')
    return
  }
  response.writeHead(401, {
    'Content-Type': 'text/plain; charset=utf-8',
    'WWW-Authenticate': 'Basic realm="Condui Community", charset="UTF-8"',
    'Cache-Control': 'no-store',
  })
  response.end('Sign in to Condui Community.')
}
