export const SUPPORTED_LANGUAGES = ['nl-BE', 'en', 'fr-BE', 'de', 'pl', 'ro'] as const
export type SupportedLanguage = (typeof SUPPORTED_LANGUAGES)[number]

export const LANGUAGE_PREFIXES: Record<SupportedLanguage, string> = {
  'nl-BE': 'nl', en: 'en', 'fr-BE': 'fr', de: 'de', pl: 'pl', ro: 'ro',
}

export const LANGUAGE_OPTIONS = SUPPORTED_LANGUAGES.map((code) => ({
  code, label: LANGUAGE_PREFIXES[code].toUpperCase(),
}))

const SHORT_LANGUAGE_MAP: Record<string, SupportedLanguage> = {
  nl: 'nl-BE',
  'nl-be': 'nl-BE',
  fr: 'fr-BE',
  'fr-be': 'fr-BE',
  en: 'en',
  de: 'de',
  'de-de': 'de',
  pl: 'pl',
  'pl-pl': 'pl',
  ro: 'ro',
  'ro-ro': 'ro',
}

export function normalizeSupportedLanguage(value: string | null | undefined): SupportedLanguage | null {
  if (!value) return null
  const code = value.trim().toLowerCase().replace('_', '-')
  return SHORT_LANGUAGE_MAP[code] ?? SHORT_LANGUAGE_MAP[code.split('-')[0] ?? ''] ?? null
}

export function getPathLanguagePrefix(pathname: string | null | undefined): SupportedLanguage | null {
  const firstSegment = (pathname ?? '').split('/').filter(Boolean)[0] ?? ''
  return normalizeSupportedLanguage(firstSegment)
}

export function stripLanguagePrefixFromPath(pathname: string): string {
  const segments = pathname.split('/').filter(Boolean)
  if (segments.length === 0) return '/'
  const maybeLanguage = normalizeSupportedLanguage(segments[0])
  const rest = maybeLanguage ? segments.slice(1) : segments
  return rest.length ? `/${rest.join('/')}` : '/'
}

export function buildPathForLanguage(pathWithoutLanguage: string, language: SupportedLanguage): string {
  const normalizedPath = pathWithoutLanguage.startsWith('/')
    ? pathWithoutLanguage
    : `/${pathWithoutLanguage}`
  const cleanedPath = normalizedPath === '/' ? '' : normalizedPath
  if (language === 'en') {
    return `/en${cleanedPath}` || '/en'
  }
  const shortPrefix = LANGUAGE_PREFIXES[language]
  return cleanedPath ? `/${shortPrefix}${cleanedPath}` : `/${shortPrefix}`
}

export function getCanonicalizedPathForDomain(pathname: string, hostname: string): string | null {
  const pathWithoutLanguage = stripLanguagePrefixFromPath(pathname)
  const explicitLanguage = getPathLanguagePrefix(pathname)

  if (!explicitLanguage) {
    return buildPathForLanguageForHostname(pathWithoutLanguage, 'nl-BE', hostname)
  }

  const canonicalPath = buildPathForLanguageForHostname(
    pathWithoutLanguage,
    explicitLanguage,
    hostname,
  )
  return canonicalPath === pathname ? null : canonicalPath
}

export function resolveDomainDefaultLanguage(_hostname: string): SupportedLanguage {
  return 'nl-BE'
}

export function buildPathForLanguageForHostname(
  pathWithoutLanguage: string,
  language: SupportedLanguage,
  _hostname: string,
): string {
  const normalizedPath = pathWithoutLanguage.startsWith('/')
    ? pathWithoutLanguage
    : `/${pathWithoutLanguage}`
  const cleanedPath = normalizedPath === '/' ? '' : normalizedPath

  if (language === 'en') {
    // English is always explicit.
    return `/en${cleanedPath}` || '/en'
  }

  const shortPrefix = LANGUAGE_PREFIXES[language]
  return cleanedPath ? `/${shortPrefix}${cleanedPath}` : `/${shortPrefix}`
}

export function buildLanguageSwitchUrl(
  currentUrl: URL,
  targetLanguage: SupportedLanguage,
): string {
  const pathWithoutLanguage = stripLanguagePrefixFromPath(currentUrl.pathname)

  const targetPath = buildPathForLanguageForHostname(pathWithoutLanguage, targetLanguage, currentUrl.hostname)
  return `${currentUrl.origin}${targetPath}${currentUrl.search}${currentUrl.hash}`
}

export const LANGUAGE_CANONICALIZATION_EXCLUDED_PREFIXES = [
  
] as const

export function isLanguageCanonicalizationExcluded(pathname: string): boolean {
  return LANGUAGE_CANONICALIZATION_EXCLUDED_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  )
}

export function isAppHomePath(pathname: string): boolean {
  const normalized = pathname.replace(/\/$/, '') || '/'
  if (normalized === '/') return true
  return stripLanguagePrefixFromPath(normalized) === '/'
}

export function buildLocalizedAppPath(
  path: string,
  language: SupportedLanguage,
  hostname: string = typeof window !== 'undefined' ? window.location.hostname : '',
): string {
  const hashIndex = path.indexOf('#')
  const hash = hashIndex >= 0 ? path.slice(hashIndex) : ''
  const pathAndSearch = hashIndex >= 0 ? path.slice(0, hashIndex) : path
  const searchIndex = pathAndSearch.indexOf('?')
  const search = searchIndex >= 0 ? pathAndSearch.slice(searchIndex) : ''
  const pathname = searchIndex >= 0 ? pathAndSearch.slice(0, searchIndex) : pathAndSearch
  const pathWithoutLanguage = stripLanguagePrefixFromPath(pathname || '/')
  return `${buildPathForLanguageForHostname(pathWithoutLanguage, language, hostname)}${search}${hash}`
}

export function applyCanonicalLanguagePathIfNeeded(): boolean {
  if (typeof window === 'undefined') return false

  const { pathname, search, hash, hostname } = window.location
  if (typeof pathname !== 'string') return false
  if (isLanguageCanonicalizationExcluded(pathname)) return false

  const canonicalPath = getCanonicalizedPathForDomain(pathname, hostname)
  if (!canonicalPath) return false

  window.history.replaceState(null, '', `${canonicalPath}${search}${hash}`)
  return true
}
