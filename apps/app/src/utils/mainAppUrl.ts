import { LANGUAGE_PREFIXES, normalizeSupportedLanguage } from './languageRouting'
const LOCALHOST_MAIN_APP_PORT_FALLBACK = '3002'
const LOCALHOST_DOCS_PORT_FALLBACK = '3004'
const LOCALHOST_AREI_PORT_FALLBACK = '3003'

export type CompanionSite = 'docs' | 'arei'

type CompanionSiteUrlOptions = {
  site: CompanionSite
  protocol: string
  hostname: string
  port: string
  language: string
  localPort?: string
}

const isLocalHost = (hostname: string): boolean => {
  const host = hostname.toLowerCase()
  return (
    host === 'localhost' ||
    host === '127.0.0.1' ||
    host === '::1' ||
    /^[0-9.]+$/.test(host) ||
    !host.includes('.')
  )
}

const toAppSubdomain = (hostname: string): string => {
  const host = hostname.toLowerCase()

  if (host.startsWith('app.')) return hostname
  if (host.startsWith('arei.')) return `app.${hostname.slice('arei.'.length)}`
  if (host.startsWith('docs.')) return `app.${hostname.slice('docs.'.length)}`

  if (
    host === 'condui.be' ||
    host === 'conduit.be' ||
    host === 'eendra.be' ||
    host === 'eendraa.be' ||
    host === 'eendra.ad'
  ) {
    return `app.${hostname}`
  }

  return hostname
}

const toCompanionSubdomain = (hostname: string, site: CompanionSite): string => {
  const normalized = hostname
    .toLowerCase()
    .replace(/(^|\.)eendraa\.be$/i, '$1condui.be')
    .replace(/(^|\.)eendra\.be$/i, '$1condui.be')
    .replace(/(^|\.)eendra\.ad$/i, '$1condui.be')
  const labels = normalized.split('.').filter(Boolean)
  const stageIndex = labels.lastIndexOf('stage')

  if (stageIndex >= 0) return [site, ...labels.slice(stageIndex + 1)].join('.')
  if (labels[0] === 'app' || labels[0] === 'docs' || labels[0] === 'arei') {
    return [site, ...labels.slice(1)].join('.')
  }
  if (normalized === 'conduit.be') return `${site}.condui.be`
  if (labels.length >= 2) return `${site}.${normalized}`
  return normalized
}

const languagePath = (language: string): string => LANGUAGE_PREFIXES[normalizeSupportedLanguage(language) ?? 'nl-BE']

export const resolveCompanionSiteUrl = ({
  site,
  protocol,
  hostname,
  port,
  language,
  localPort,
}: CompanionSiteUrlOptions): string => {
  const prefix = languagePath(language)

  if (isLocalHost(hostname)) {
    const fallbackPort = site === 'docs' ? LOCALHOST_DOCS_PORT_FALLBACK : LOCALHOST_AREI_PORT_FALLBACK
    return `${protocol}//${hostname}:${localPort || fallbackPort}/${prefix}/`
  }

  const companionHost = toCompanionSubdomain(hostname, site)
  const portSuffix = port ? `:${port}` : ''
  return `${protocol}//${companionHost}${portSuffix}/${prefix}/`
}

export const getCompanionSiteUrl = (site: CompanionSite, language: string): string => {
  if (typeof window === 'undefined') return `/${languagePath(language)}/`

  const { protocol, hostname, port } = window.location
  const localPort = site === 'docs'
    ? import.meta.env.VITE_DOCS_PORT || LOCALHOST_DOCS_PORT_FALLBACK
    : import.meta.env.VITE_AREI_PORT || LOCALHOST_AREI_PORT_FALLBACK

  return resolveCompanionSiteUrl({ site, protocol, hostname, port, language, localPort })
}

export const getMainAppUrl = (): string => {
  if (typeof window === 'undefined') return '/'

  const { protocol, hostname, port } = window.location

  if (isLocalHost(hostname)) {
    const mainPort = import.meta.env.VITE_MAIN_APP_PORT || LOCALHOST_MAIN_APP_PORT_FALLBACK
    return `${protocol}//${hostname}:${mainPort}/`
  }

  const mainHost = toAppSubdomain(hostname)
  const portSuffix = port ? `:${port}` : ''
  return `${protocol}//${mainHost}${portSuffix}/`
}
