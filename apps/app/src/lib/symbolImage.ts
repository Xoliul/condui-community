import { logger } from '@/lib/logger'
/**
 * SVG Symbol Loading with currentColor-based theme
 *
 * Fetches SVG symbols, injects theme color so currentColor resolves correctly,
 * and returns an HTMLImageElement (blob URL) for Konva. No rasterization —
 * the browser rasterizes at draw time so zoom stays sharp.
 *
 * iPad Safari: SVGs must have explicit width/height on the root <svg> so
 * intrinsic size is consistent (see scripts/svg_set_explicit_size.py).
 */

import { flattenSymbolSvgForExport } from '@/lib/export/symbolSvgFlatten'
import { THEME_COLORS } from '@/lib/theme/colors'
import {
  BOILER_SVG_PATHS,
  DOMOTICA_CONTROL_OVERLAY_PATHS,
  HEATING_SVG_PATHS,
  HVAC_ENERGY_SOURCE_PATHS,
  HVAC_TYPE_OVERLAY_PATHS,
  LIGHT_POINT_OVERLAY_PATHS,
  LIGHT_SPOT_OVERLAY_PATHS,
  RELAY_OVERLAY_PATHS,
  SMOKE_DETECTOR_OVERLAY_PATHS,
  SOCKET_OVERLAY_PATHS,
  SWITCH_OVERLAY_PATHS,
  TRANSFORMER_OVERLAY_PATHS,
  symbols,
} from '@/lib/symbols'
import { PLAN_GRAPHIC_ELEMENT_ASSETS } from '@/lib/plan/graphicElements'
import { getConverterArtworkCatalogPaths } from '@/lib/converterArtwork'
import { resolveProtectionSvgPath } from '@/lib/detailedProtectionSymbols'

const blobUrlCache = new Map<string, string>()
/**
 * Raw catalog SVGs already loaded by the editor.
 *
 * PDF export applies its own theme and vector flattening, so it cannot reuse the
 * processed blob URL directly. Keeping the source text lets an open editor
 * finish an export when the app server becomes temporarily unavailable (for
 * example during a local Vite restart) without issuing a second network request.
 */
const rawSvgTextCache = new Map<string, Promise<string>>()
const pendingSymbolImages = new Set<Promise<HTMLImageElement>>()
const processedSymbolImages = new Map<string, Promise<HTMLImageElement>>()
const MAX_PROCESSED_SYMBOL_IMAGES = 64
/** Maps loaded image src (blob/data URL) back to catalog SVG path for export. */
const symbolImageSrcRegistry = new Map<string, string>()
/** Maps loaded HTMLImageElement instances to catalog paths (survives Konva clone by reference). */
const symbolColorByImageElement = new WeakMap<HTMLImageElement, string>()
const symbolColorBySrc = new Map<string, string>()
export function resolveSymbolColorFromImageElement(image: HTMLImageElement): string | undefined {
  return symbolColorByImageElement.get(image) ?? symbolColorBySrc.get(image.currentSrc || image.src)
}
export function resolveSymbolColorFromImageSrc(src: string): string | undefined {
  return symbolColorBySrc.get(src)
}

const symbolPathByImageElement = new WeakMap<HTMLImageElement, string>()

export const SYMBOL_EXPORT_ATTR_SVG_PATH = 'symbolExportSvgPath'

function registerSymbolImageSrc(src: string, svgPath: string): void {
  if (src) symbolImageSrcRegistry.set(src, svgPath)
}

function registerSymbolImageElement(image: HTMLImageElement, svgPath: string): void {
  symbolPathByImageElement.set(image, svgPath)
  registerSymbolImageSrc(image.src, svgPath)
  if (image.currentSrc) registerSymbolImageSrc(image.currentSrc, svgPath)
}

/** Bump when themed SVG processing changes so in-memory blob caches refresh. */
const SYMBOL_THEME_PROCESSING_VERSION = '5'

function themedSymbolCacheKey(svgPath: string, isDark: boolean, color?: string): string {
  return `${SYMBOL_THEME_PROCESSING_VERSION}::${svgPath}::${isDark ? 'dark' : 'light'}::${color ?? ''}`
}

/** Blob URL when this symbol was already loaded or warmed (e.g. offline library preview). */
export function getCachedThemedSymbolBlobUrl(svgPath: string, isDark: boolean): string | undefined {
  return blobUrlCache.get(themedSymbolCacheKey(svgPath, isDark))
}

const EXTRA_SYMBOL_SVG_PATHS = [
  '/symbols/switches/switch_2p.svg',
  '/symbols/switches/switch_3p.svg',
  '/symbols/switches/switch_4p.svg',
  '/symbols/switches/switch_2p_twoway.svg',
  '/symbols/switches/relay.svg',
  '/symbols/switches/smoke_detector_base.svg',
  '/symbols/switches/motion_detector_generic.svg',
  '/symbols/energy-conversion/symbol_AC.svg',
  '/symbols/energy-conversion/symbol_DC.svg',
  ...getConverterArtworkCatalogPaths(),
] as const

function getThemeSymbolColor(isDark: boolean): string {
  return THEME_COLORS[isDark ? 'dark' : 'light'].symbolColor
}

/**
 * Replace common black in SVG with currentColor so injected color applies.
 */
function replaceBlackWithCurrentColor(svgText: string): string {
  return svgText.replace(/#000000/gi, 'currentColor').replace(/#000\b/g, 'currentColor')
}

/**
 * Inject color on the root <svg> so currentColor resolves to the theme color.
 * Merges into existing style= if present (e.g. protection SVGs have style="enable-background:...")
 * so we don't create duplicate style attributes that can break parsing.
 */
function resolveCurrentColorLiterals(svgText: string, colorHex: string): string {
  const hex = colorHex.startsWith('#') ? colorHex : `#${colorHex}`
  return svgText.replace(/currentColor/gi, hex)
}

function injectThemeColor(svgText: string, colorHex: string): string {
  const hex = colorHex.startsWith('#') ? colorHex : `#${colorHex}`
  const colorDecl = `color:${hex}`

  // Root <svg> already has style="...": prepend our color so it wins
  const withExistingStyle = svgText.replace(
    /<svg(\s[^>]*?)style\s*=\s*["']([^"']*)["']/i,
    (_, rest, existingStyle) => `<svg${rest}style="${colorDecl};${existingStyle}"`
  )
  if (withExistingStyle !== svgText) return withExistingStyle

  // No existing style: insert style="color: <hex>" after the first <svg
  return svgText.replace(/<svg(\s)/i, `<svg$1style="color:${hex}" `)
}

/**
 * Apply canvas/export theme colors to raw catalog SVG text.
 * Class-based SVG styles are not reliably applied when the SVG is rasterized
 * through an HTMLImageElement (Konva), so bake them into attributes.
 */
export function applySymbolThemeToSvgText(
  svgText: string,
  isDark: boolean,
  colorOverride?: string
): string {
  const color = colorOverride ?? getThemeSymbolColor(isDark)
  let text = replaceBlackWithCurrentColor(svgText)
  text = injectThemeColor(text, color)
  text = flattenSymbolSvgForExport(text, color, 'sym_')
  return resolveCurrentColorLiterals(text, color)
}

/**
 * Load SVG as text and apply export/canvas theme colors.
 */
export async function fetchThemedSymbolSvgText(
  svgPath: string,
  isDark: boolean,
  color?: string
): Promise<string> {
  let rawSvgPromise = rawSvgTextCache.get(svgPath)
  if (!rawSvgPromise) {
    rawSvgPromise = fetch(svgPath, {
      credentials: 'same-origin',
      cache: 'no-cache',
    }).then(async (res) => {
      if (!res.ok) throw new Error(`Failed to fetch SVG: ${svgPath} (${res.status})`)
      return res.text()
    })
    rawSvgTextCache.set(svgPath, rawSvgPromise)
    rawSvgPromise.catch(() => {
      if (rawSvgTextCache.get(svgPath) === rawSvgPromise) {
        rawSvgTextCache.delete(svgPath)
      }
    })
  }
  return applySymbolThemeToSvgText(await rawSvgPromise, isDark, color)
}

/**
 * Load SVG as text, apply theme, return blob URL.
 */
async function fetchThemedSvgBlobUrl(
  svgPath: string,
  isDark: boolean,
  color?: string
): Promise<string> {
  const text = await fetchThemedSymbolSvgText(svgPath, isDark, color)
  const blob = new Blob([text], { type: 'image/svg+xml' })
  return URL.createObjectURL(blob)
}

/** Resolve catalog SVG path from a themed symbol image element or URL. */
export function resolveSymbolSvgPathFromImageElement(image: HTMLImageElement): string | null {
  const fromWeak = symbolPathByImageElement.get(image)
  if (fromWeak) return fromWeak
  return resolveSymbolSvgPathFromImageSrc(image.currentSrc || image.src)
}

/** Resolve catalog SVG path from a themed symbol blob URL (export vector inlining). */
export function resolveSymbolSvgPathFromImageSrc(src: string): string | null {
  if (!src) return null
  const registered = symbolImageSrcRegistry.get(src)
  if (registered) return registered
  for (const [key, blobUrl] of blobUrlCache) {
    if (blobUrl === src) {
      const path = key.split('::')[0]
      return path || null
    }
  }
  return null
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error(`Failed to load image: ${src}`))
    img.src = src
  })
}

/**
 * Load an SVG symbol with theme applied via currentColor. Returns an
 * HTMLImageElement that Konva can use with explicit width/height.
 */
function createProcessedSymbolImage(
  svgPath: string,
  isDark: boolean,
  color?: string
): Promise<HTMLImageElement> {
  const cacheKey = themedSymbolCacheKey(svgPath, isDark, color)
  const cachedUrl = blobUrlCache.get(cacheKey)
  if (cachedUrl) {
    registerSymbolImageSrc(cachedUrl, svgPath)
    return loadImage(cachedUrl).then((image) => {
      registerSymbolImageElement(image, svgPath)
      if (color) {
        symbolColorByImageElement.set(image, color)
        symbolColorBySrc.set(image.src, color)
      }
      return image
    })
  }

  return fetchThemedSvgBlobUrl(svgPath, isDark, color).then((blobUrl) => {
    blobUrlCache.set(cacheKey, blobUrl)
    registerSymbolImageSrc(blobUrl, svgPath)
    return loadImage(blobUrl).then((image) => {
      registerSymbolImageElement(image, svgPath)
      if (color) {
        symbolColorByImageElement.set(image, color)
        symbolColorBySrc.set(image.src, color)
      }
      return image
    })
  })
}

export function loadProcessedSymbol(
  svgPath: string,
  isDark: boolean,
  color?: string
): Promise<HTMLImageElement> {
  const key = themedSymbolCacheKey(svgPath, isDark, color)
  const cached = processedSymbolImages.get(key)
  if (cached) {
    processedSymbolImages.delete(key)
    processedSymbolImages.set(key, cached)
    return cached
  }
  // Canvas instances can share an immutable decoded catalog image. Recreating
  // it per placed symbol adds load events, image objects and React commits.
  const pending = createProcessedSymbolImage(svgPath, isDark, color)
  processedSymbolImages.set(key, pending)
  if (processedSymbolImages.size > MAX_PROCESSED_SYMBOL_IMAGES)
    processedSymbolImages.delete(processedSymbolImages.keys().next().value!)
  pendingSymbolImages.add(pending)
  const settled = () => pendingSymbolImages.delete(pending)
  void pending.then(settled, settled)
  void pending.catch(() => {
    if (processedSymbolImages.get(key) === pending) processedSymbolImages.delete(key)
  })
  return pending
}

/** Wait for symbols started by a just-materialized export scene, including follow-up loads. */
export async function awaitPendingSymbolImages(): Promise<void> {
  while (pendingSymbolImages.size > 0) {
    await Promise.allSettled([...pendingSymbolImages])
  }
}

/**
 * Clear the symbol cache (e.g. on theme change). Revokes blob URLs to avoid leaks.
 */
export function clearSymbolCache(): void {
  for (const url of blobUrlCache.values()) {
    URL.revokeObjectURL(url)
  }
  blobUrlCache.clear()
  processedSymbolImages.clear()
  symbolImageSrcRegistry.clear()
  symbolColorBySrc.clear()
}

function collectPathConstants(pathGroups: ReadonlyArray<Record<string, string>>): string[] {
  const paths: string[] = []
  for (const group of pathGroups) {
    paths.push(...Object.values(group))
  }
  return paths
}

/** SVG paths for symbols shown in the library panel (for offline warm-up). */
export function getLibrarySymbolSvgPaths(): string[] {
  const paths = new Set<string>()
  for (const symbol of symbols) {
    if (symbol.hiddenFromLibrary) continue
    const trimmed = symbol.svgPath?.trim()
    if (trimmed) paths.add(trimmed)
  }
  return Array.from(paths)
}

/** All static SVG paths used by canvas symbol rendering (for offline warm-up). */
export function getAllSymbolSvgPaths(): string[] {
  const paths = new Set<string>([
    ...symbols.map((symbol) => symbol.svgPath).filter(Boolean),
    ...getLibrarySymbolSvgPaths(),
    ...EXTRA_SYMBOL_SVG_PATHS,
    ...collectPathConstants([
      SOCKET_OVERLAY_PATHS,
      SWITCH_OVERLAY_PATHS,
      RELAY_OVERLAY_PATHS,
      SMOKE_DETECTOR_OVERLAY_PATHS,
      LIGHT_POINT_OVERLAY_PATHS,
      LIGHT_SPOT_OVERLAY_PATHS,
      TRANSFORMER_OVERLAY_PATHS,
      HVAC_ENERGY_SOURCE_PATHS,
      HVAC_TYPE_OVERLAY_PATHS,
      DOMOTICA_CONTROL_OVERLAY_PATHS,
      BOILER_SVG_PATHS,
      HEATING_SVG_PATHS,
    ]),
    ...PLAN_GRAPHIC_ELEMENT_ASSETS.map((asset) => asset.svgPath),
  ])
  return Array.from(paths)
}

async function mapWithConcurrency<T>(
  items: readonly T[],
  concurrency: number,
  worker: (item: T) => Promise<void>
): Promise<void> {
  if (items.length === 0) return
  let index = 0
  const runners = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (index < items.length) {
      const current = items[index]
      index += 1
      if (current === undefined) continue
      await worker(current)
    }
  })
  await Promise.all(runners)
}

/**
 * Preload themed symbol SVGs into the in-memory cache (and service worker cache when installed).
 * Call after startup and when the color theme changes.
 */
export async function warmSymbolSvgCache(options?: {
  isDark?: boolean
  bothThemes?: boolean
  /** Warm the detailed protection drawings instead of the simple ones. */
  detailedProtectionSymbols?: boolean
}): Promise<void> {
  const detailed = options?.detailedProtectionSymbols === true
  const paths = Array.from(
    new Set(getAllSymbolSvgPaths().map((path) => resolveProtectionSvgPath(path, detailed)))
  )
  const themes = options?.bothThemes === true ? [true, false] : [options?.isDark ?? false]

  await mapWithConcurrency(
    themes.flatMap((isDark) => paths.map((path) => ({ path, isDark }))),
    8,
    async ({ path, isDark }) => {
      try {
        await loadProcessedSymbol(path, isDark)
      } catch (error) {
        logger.warn('[symbolImage] warm-up failed:', path, error)
      }
    }
  )
}
