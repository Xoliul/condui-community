/**
 * Utility functions for processing plan images:
 * - Detecting white backgrounds
 * - Removing white backgrounds (making transparent)
 * - Inverting colors for dark mode
 */

import {
  createImagePixelSampler,
  mapCanvasPixelsInBands,
  releaseCanvas,
} from '@/utils/canvasPixelOps'
import {
  detectWhiteFromSampler,
  detectWhitePageBackgroundFromSampler,
  invertForDarkModeInPlace,
  removeWhitePixelsInPlace,
} from '@/lib/image/planImagePixelOps'
import {
  invertImageColorsInWorker,
  planImageWorkerSupported,
  removeWhiteBackgroundInWorker,
} from '@/lib/image/planImageWorkerClient'
import { fitCanvasSize } from '@/utils/canvasSizeLimit'

export interface PlanImageProcessingResult {
  processedDataUrl: string
  hasWhiteBackground: boolean
  originalDataUrl: string
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new window.Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('Failed to load image'))
    img.src = url
  })
}

/** Drops the decoded pixels of a temporary image so they do not wait for garbage collection. */
function releaseImage(img: HTMLImageElement): void {
  img.onload = null
  img.onerror = null
  img.removeAttribute('src')
}

/** Draws the image onto a scratch canvas, edits it band by band, and returns the PNG data URL. */
function editImageToDataUrl(
  image: HTMLImageElement,
  edit: (data: Uint8ClampedArray) => void,
): string {
  const canvas = document.createElement('canvas')
  try {
    // Natural size, like before; only sizes a browser cannot allocate are reduced.
    const size = fitCanvasSize(image.naturalWidth || image.width, image.naturalHeight || image.height)
    canvas.width = size.width
    canvas.height = size.height
    const ctx = canvas.getContext('2d', { willReadFrequently: true })
    if (!ctx) return ''
    ctx.drawImage(image, 0, 0, size.width, size.height)
    mapCanvasPixelsInBands(ctx, canvas.width, canvas.height, edit)
    return canvas.toDataURL('image/png')
  } finally {
    releaseCanvas(canvas)
  }
}

/** Same as regular background processing, but only when a painted white page is detected. */
export async function processPdfRasterBackground(
  imageDataUrl: string,
  threshold: number = 240,
  tolerance: number = 20,
): Promise<PlanImageProcessingResult> {
  const img = await loadImage(imageDataUrl)
  try {
    const width = img.naturalWidth || img.width
    const height = img.naturalHeight || img.height
    // Detection only reads the page border, so it never needs a full-frame pixel buffer.
    const sampler = createImagePixelSampler(img)
    if (!sampler) throw new Error('Failed to create canvas context')
    let hasWhiteBackground: boolean
    try {
      hasWhiteBackground = detectWhitePageBackgroundFromSampler(
        sampler.sample,
        width,
        height,
        threshold,
        tolerance,
      )
    } finally {
      sampler.dispose()
    }
    if (!hasWhiteBackground) {
      return { processedDataUrl: imageDataUrl, hasWhiteBackground: false, originalDataUrl: imageDataUrl }
    }
    // Remove every near-white pixel, not only the page margin: rooms enclosed by walls are
    // white too, and left opaque they invert to black blocks in dark mode.
    const processedDataUrl = editImageToDataUrl(img, (data) =>
      removeWhitePixelsInPlace(data, threshold, tolerance),
    )
    if (!processedDataUrl) throw new Error('Failed to create canvas context')
    return { processedDataUrl, hasWhiteBackground: true, originalDataUrl: imageDataUrl }
  } finally {
    releaseImage(img)
  }
}

export interface InlineSvgEmbeddedImagesResult {
  svg: string
  hadEmbeddedImages: boolean
  hadUnresolvedImages: boolean
}

const SVG_XLINK_NS = 'http://www.w3.org/1999/xlink'

function collectSvgImageElements(root: Element): Element[] {
  const images: Element[] = []
  const visit = (node: Element) => {
    if (node.localName?.toLowerCase() === 'image') images.push(node)
    for (const child of Array.from(node.children)) {
      if (child instanceof Element) visit(child)
    }
  }
  visit(root)
  return images
}

function getSvgImageHref(element: Element): string | null {
  const direct = element.getAttribute('href')
  if (direct) return direct
  const xlink = element.getAttributeNS(SVG_XLINK_NS, 'href')
  if (xlink) return xlink
  for (const attr of Array.from(element.attributes)) {
    if (attr.localName === 'href' && attr.value) return attr.value
  }
  return null
}

function setSvgImageHref(element: Element, value: string): void {
  element.setAttribute('href', value)
  element.setAttributeNS(SVG_XLINK_NS, 'href', value)
  for (const attr of Array.from(element.attributes)) {
    if (attr.localName === 'href') {
      element.setAttribute(attr.name, value)
    }
  }
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(reader.error ?? new Error('Failed to read embedded image blob'))
    reader.readAsDataURL(blob)
  })
}

export function svgHasUnresolvedEmbeddedImages(svgContent: string): boolean {
  const parser = new DOMParser()
  const doc = parser.parseFromString(svgContent, 'image/svg+xml')
  return collectSvgImageElements(doc.documentElement).some((imageEl) => {
    const href = getSvgImageHref(imageEl)
    return !!href && !href.startsWith('data:image/')
  })
}

export async function inlineSvgEmbeddedImages(
  svgContent: string,
): Promise<InlineSvgEmbeddedImagesResult> {
  const parser = new DOMParser()
  const doc = parser.parseFromString(svgContent, 'image/svg+xml')
  const svg = doc.documentElement
  let hadEmbeddedImages = false
  let hadUnresolvedImages = false

  for (const imageEl of collectSvgImageElements(svg)) {
    const href = getSvgImageHref(imageEl)
    if (!href || href.startsWith('data:image/')) continue
    hadEmbeddedImages = true
    if (!href.startsWith('blob:')) {
      hadUnresolvedImages = true
      continue
    }
    try {
      const response = await fetch(href)
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      const blob = await response.blob()
      const dataUrl = await blobToDataUrl(blob)
      setSvgImageHref(imageEl, dataUrl)
    } catch {
      hadUnresolvedImages = true
    }
  }

  return {
    svg: new XMLSerializer().serializeToString(svg),
    hadEmbeddedImages,
    hadUnresolvedImages,
  }
}

/**
 * Detects if an image has a predominantly white background
 * by sampling pixels from edges and center
 */
export function detectWhiteBackground(
  image: HTMLImageElement,
  threshold: number = 240
): boolean {
  const sampler = createImagePixelSampler(image)
  if (!sampler) return false
  try {
    return detectWhiteFromSampler(
      sampler.sample,
      image.naturalWidth || image.width,
      image.naturalHeight || image.height,
      threshold,
    )
  } finally {
    sampler.dispose()
  }
}

/**
 * Removes white background from an image by making white pixels transparent
 */
export function removeWhiteBackground(
  image: HTMLImageElement,
  threshold: number = 240,
  tolerance: number = 20
): string {
  return editImageToDataUrl(image, (data) => removeWhitePixelsInPlace(data, threshold, tolerance))
}

/**
 * Inverts colors of an image (for dark mode)
 */
export function invertImageColors(image: HTMLImageElement): string {
  return editImageToDataUrl(image, (data) => invertForDarkModeInPlace(data))
}

/**
 * Processes a plan image: detects white background, removes it, and optionally inverts for dark mode
 */
export async function processPlanImage(
  imageDataUrl: string,
  invertForDarkMode: boolean = false
): Promise<PlanImageProcessingResult> {
  const img = await loadImage(imageDataUrl)
  try {
    const hasWhiteBackground = detectWhiteBackground(img)
    if (!hasWhiteBackground) {
      return { processedDataUrl: imageDataUrl, hasWhiteBackground: false, originalDataUrl: imageDataUrl }
    }
    const useWorker = planImageWorkerSupported()
    // Dark-mode inversion already clears the white paper before inverting, so inverting the
    // source in one pass equals remove-then-invert without the intermediate PNG round trip.
    const processedDataUrl = invertForDarkMode
      ? useWorker
        ? await invertImageColorsInWorker(img).catch(() => invertImageColors(img))
        : invertImageColors(img)
      : useWorker
        ? await removeWhiteBackgroundInWorker(img).catch(() => removeWhiteBackground(img))
        : removeWhiteBackground(img)
    return { processedDataUrl, hasWhiteBackground: true, originalDataUrl: imageDataUrl }
  } finally {
    releaseImage(img)
  }
}

/**
 * Applies dark mode inversion to an already processed image (with transparent background)
 */
export async function applyDarkModeInversion(imageDataUrl: string): Promise<string> {
  const img = await loadImage(imageDataUrl)
  try {
    return planImageWorkerSupported()
      ? await invertImageColorsInWorker(img).catch(() => invertImageColors(img))
      : invertImageColors(img)
  } finally {
    releaseImage(img)
  }
}

function isNearWhiteColor(input: string): boolean {
  const parsed = parseRgbColor(input)
  return parsed != null && parsed.r >= 235 && parsed.g >= 235 && parsed.b >= 235
}

function invertFillForDarkMode(input: string): string {
  return isNearWhiteColor(input) ? 'none' : invertRgbColor(input)
}

function invertRgbColor(input: string): string {
  const color = input.trim()
  if (!color || color === 'none' || color === 'currentColor' || color.startsWith('url(') || color.startsWith('var(')) {
    return input
  }
  const hex = color.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i)
  if (hex) {
    const value = hex[1]
    if (!value) {
      return input
    }
    if (value.length === 3) {
      const [rHex, gHex, bHex] = value.split('')
      if (!rHex || !gHex || !bHex) {
        return input
      }
      const r = parseInt(rHex + rHex, 16)
      const g = parseInt(gHex + gHex, 16)
      const b = parseInt(bHex + bHex, 16)
      return `#${(255 - r).toString(16).padStart(2, '0')}${(255 - g).toString(16).padStart(2, '0')}${(255 - b).toString(16).padStart(2, '0')}`
    }
    const r = parseInt(value.slice(0, 2), 16)
    const g = parseInt(value.slice(2, 4), 16)
    const b = parseInt(value.slice(4, 6), 16)
    return `#${(255 - r).toString(16).padStart(2, '0')}${(255 - g).toString(16).padStart(2, '0')}${(255 - b).toString(16).padStart(2, '0')}`
  }
  const rgb = color.match(/^rgba?\(\s*([0-9.]+)\s*[, ]\s*([0-9.]+)\s*[, ]\s*([0-9.]+)(?:\s*[,/]\s*([0-9.]+))?\s*\)$/i)
  if (rgb) {
    const r = Math.max(0, Math.min(255, Number(rgb[1])))
    const g = Math.max(0, Math.min(255, Number(rgb[2])))
    const b = Math.max(0, Math.min(255, Number(rgb[3])))
    const a = rgb[4]
    if (a != null) return `rgba(${255 - r}, ${255 - g}, ${255 - b}, ${a})`
    return `rgb(${255 - r}, ${255 - g}, ${255 - b})`
  }
  return input
}

function invertStyleColorDeclarations(style: string): string {
  return style.replace(
    /(fill|stroke|stop-color)\s*:\s*([^;]+)/gi,
    (_all, prop: string, value: string) => {
      const normalizedProp = prop.toLowerCase()
      const nextValue =
        normalizedProp === 'fill' ? invertFillForDarkMode(value) : invertRgbColor(value)
      return `${prop}: ${nextValue}`
    }
  )
}

function grayscaleRgbColor(input: string): string {
  const color = input.trim()
  if (!color || color === 'none' || color === 'currentColor' || color.startsWith('url(') || color.startsWith('var(')) {
    return input
  }
  const toGray = (r: number, g: number, b: number) => {
    const gray = Math.round(0.2126 * r + 0.7152 * g + 0.0722 * b)
    return gray
  }
  const hex = color.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i)
  if (hex) {
    const value = hex[1]
    if (!value) return input
    const expanded = value.length === 3
      ? value.split('').map((part) => part + part).join('')
      : value
    const r = parseInt(expanded.slice(0, 2), 16)
    const g = parseInt(expanded.slice(2, 4), 16)
    const b = parseInt(expanded.slice(4, 6), 16)
    const gray = toGray(r, g, b).toString(16).padStart(2, '0')
    return `#${gray}${gray}${gray}`
  }
  const rgb = color.match(/^rgba?\(\s*([0-9.]+)\s*[, ]\s*([0-9.]+)\s*[, ]\s*([0-9.]+)(?:\s*[,/]\s*([0-9.]+))?\s*\)$/i)
  if (rgb) {
    const r = Math.max(0, Math.min(255, Number(rgb[1])))
    const g = Math.max(0, Math.min(255, Number(rgb[2])))
    const b = Math.max(0, Math.min(255, Number(rgb[3])))
    const gray = toGray(r, g, b)
    const a = rgb[4]
    if (a != null) return `rgba(${gray}, ${gray}, ${gray}, ${a})`
    return `rgb(${gray}, ${gray}, ${gray})`
  }
  return input
}

function grayscaleStyleColorDeclarations(style: string): string {
  return style.replace(
    /(fill|stroke|stop-color)\s*:\s*([^;]+)/gi,
    (_all, prop: string, value: string) => `${prop}: ${grayscaleRgbColor(value)}`
  )
}

export function grayscaleSvgColors(svgContent: string): string {
  const parser = new DOMParser()
  const doc = parser.parseFromString(svgContent, 'image/svg+xml')
  const svg = doc.documentElement

  const styleElements = Array.from(svg.querySelectorAll('style'))
  for (const styleEl of styleElements) {
    const cssText = styleEl.textContent ?? ''
    if (cssText) styleEl.textContent = grayscaleStyleColorDeclarations(cssText)
  }

  const elements = Array.from(svg.querySelectorAll('*'))
  for (const element of elements) {
    const tagName = element.tagName.toLowerCase()
    const style = element.getAttribute('style')
    if (style) element.setAttribute('style', grayscaleStyleColorDeclarations(style))
    if (tagName === 'image') continue
    const fill = element.getAttribute('fill')
    if (fill) element.setAttribute('fill', grayscaleRgbColor(fill))
    const stroke = element.getAttribute('stroke')
    if (stroke) element.setAttribute('stroke', grayscaleRgbColor(stroke))
    const stopColor = element.getAttribute('stop-color')
    if (stopColor) element.setAttribute('stop-color', grayscaleRgbColor(stopColor))
  }

  return new XMLSerializer().serializeToString(svg)
}

function parseRgbColor(input: string): { r: number; g: number; b: number } | null {
  const color = input.trim()
  if (!color || color === 'none' || color === 'currentColor' || color.startsWith('url(') || color.startsWith('var(')) {
    return null
  }
  const hex = color.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i)
  if (hex) {
    const value = hex[1]
    if (!value) return null
    const expanded = value.length === 3
      ? value.split('').map((part) => part + part).join('')
      : value
    return {
      r: parseInt(expanded.slice(0, 2), 16),
      g: parseInt(expanded.slice(2, 4), 16),
      b: parseInt(expanded.slice(4, 6), 16),
    }
  }
  const rgb = color.match(/^rgba?\(\s*([0-9.]+)\s*[, ]\s*([0-9.]+)\s*[, ]\s*([0-9.]+)(?:\s*[,/]\s*([0-9.]+))?\s*\)$/i)
  if (!rgb) return null
  return {
    r: Math.max(0, Math.min(255, Number(rgb[1]))),
    g: Math.max(0, Math.min(255, Number(rgb[2]))),
    b: Math.max(0, Math.min(255, Number(rgb[3]))),
  }
}

function isMeaningfullyColored(color: { r: number; g: number; b: number }): boolean {
  const max = Math.max(color.r, color.g, color.b)
  const min = Math.min(color.r, color.g, color.b)
  return max - min >= 24
}

export function svgHasMeaningfulColor(svgContent: string): boolean {
  const parser = new DOMParser()
  const doc = parser.parseFromString(svgContent, 'image/svg+xml')
  const svg = doc.documentElement
  const candidates: string[] = []

  for (const styleEl of Array.from(svg.querySelectorAll('style'))) {
    const cssText = styleEl.textContent ?? ''
    cssText.replace(/(?:fill|stroke|stop-color)\s*:\s*([^;{}]+)/gi, (_all, value: string) => {
      candidates.push(value)
      return ''
    })
  }

  for (const element of Array.from(svg.querySelectorAll('*'))) {
    for (const attr of ['fill', 'stroke', 'stop-color']) {
      const value = element.getAttribute(attr)
      if (value) candidates.push(value)
    }
    const style = element.getAttribute('style') ?? ''
    style.replace(/(?:fill|stroke|stop-color)\s*:\s*([^;]+)/gi, (_all, value: string) => {
      candidates.push(value)
      return ''
    })
  }

  return candidates.some((candidate) => {
    const color = parseRgbColor(candidate)
    return color ? isMeaningfullyColored(color) : false
  })
}

/**
 * Invert SVG colors without rasterizing vectors.
 * Vector fills/strokes are inverted in-place, and embedded raster images are processed separately.
 */
export async function invertSvgForDarkMode(svgContent: string): Promise<string> {
  const parser = new DOMParser()
  const doc = parser.parseFromString(svgContent, 'image/svg+xml')
  const svg = doc.documentElement

  const styleElements = Array.from(svg.querySelectorAll('style'))
  for (const styleEl of styleElements) {
    const cssText = styleEl.textContent ?? ''
    if (!cssText) continue
    styleEl.textContent = invertStyleColorDeclarations(cssText)
  }

  const elements = Array.from(svg.querySelectorAll('*'))
  for (const element of elements) {
    const tagName = element.tagName.toLowerCase()
    const style = element.getAttribute('style')
    if (style) element.setAttribute('style', invertStyleColorDeclarations(style))

    if (tagName === 'image') continue

    const fill = element.getAttribute('fill')
    if (fill) element.setAttribute('fill', invertFillForDarkMode(fill))
    const stroke = element.getAttribute('stroke')
    if (stroke) element.setAttribute('stroke', invertRgbColor(stroke))
    const stopColor = element.getAttribute('stop-color')
    if (stopColor) element.setAttribute('stop-color', invertRgbColor(stopColor))

    const isTextLike =
      tagName === 'text' || tagName === 'tspan' || tagName === 'svg:text' || tagName === 'svg:tspan'
    if (isTextLike) {
      const fillAttr = element.getAttribute('fill')
      const hasFillAttr = fillAttr != null && fillAttr.trim() !== ''
      const styleAttr = element.getAttribute('style') ?? ''
      const hasInlineFill = /(^|;)\s*fill\s*:/i.test(styleAttr)
      if (!hasFillAttr && !hasInlineFill) {
        // Default text fill in SVG is black; force white in dark mode.
        element.setAttribute('fill', '#ffffff')
      }
    }
  }

  const imageElements = Array.from(svg.querySelectorAll('image'))
  for (const imageEl of imageElements) {
    const href = imageEl.getAttribute('href') ?? imageEl.getAttributeNS('http://www.w3.org/1999/xlink', 'href')
    if (!href || !href.startsWith('data:image/')) continue
    const invertedHref = await applyDarkModeInversion(href)
    imageEl.setAttribute('href', invertedHref)
    imageEl.setAttributeNS('http://www.w3.org/1999/xlink', 'href', invertedHref)
  }

  return new XMLSerializer().serializeToString(svg)
}

export function svgContentToDataUrl(svgContent: string): string {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svgContent)}`
}

/**
 * Crops an image to a PNG data URL. `crop` is expressed in `sourceSize` units and
 * scaled to the image's natural pixels, matching the import cropper's output.
 */
export async function cropImageDataUrl(
  dataUrl: string,
  crop: { x: number; y: number; width: number; height: number },
  sourceSize: { width: number; height: number },
): Promise<string> {
  const img = await loadImage(dataUrl)
  const canvas = document.createElement('canvas')
  try {
    const scaleX = img.naturalWidth / sourceSize.width
    const scaleY = img.naturalHeight / sourceSize.height
    const width = Math.max(1, Math.round(crop.width * scaleX))
    const height = Math.max(1, Math.round(crop.height * scaleY))
    const output = fitCanvasSize(width, height)
    canvas.width = output.width
    canvas.height = output.height
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('canvas unavailable')
    ctx.drawImage(
      img,
      crop.x * scaleX,
      crop.y * scaleY,
      width,
      height,
      0,
      0,
      output.width,
      output.height,
    )
    return canvas.toDataURL('image/png')
  } finally {
    releaseCanvas(canvas)
    releaseImage(img)
  }
}

export async function getVectorSvgThemePreviewUrl(
  svgContent: string,
  isDarkMode: boolean,
): Promise<string> {
  if (!isDarkMode) return svgContentToDataUrl(svgContent)
  const darkSvg = await invertSvgForDarkMode(svgContent)
  return svgContentToDataUrl(darkSvg)
}

export async function getRasterThemePreviewUrl(
  imageDataUrl: string,
  isDarkMode: boolean,
): Promise<string> {
  if (!isDarkMode) return imageDataUrl
  // Inversion clears near-white paper itself, so the source is inverted directly instead of
  // first producing a white-removed copy.
  return applyDarkModeInversion(imageDataUrl)
}
