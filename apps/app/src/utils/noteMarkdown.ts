/**
 * Note Markdown Parser
 * 
 * Supports inline formatting:
 * - **bold**
 * - *italic*
 * - __underline__
 * - [size=16]text[/size]
 * - Combinations: **_bold italic_**
 */

export interface TextSegment {
  text: string
  bold: boolean
  italic: boolean
  underline: boolean
  fontSize?: number // If undefined, use default
}

export interface ParsedLine {
  segments: TextSegment[]
  lineHeight: number
}

/** Used for canvas note line spacing: each line height = max(segment font) × this. */
export const NOTE_CANVAS_LINE_HEIGHT_MULT = 1.2

/** Padding around note text on canvas scales with default font size (hit box + selection). */
export function noteCanvasChromePadding(fontSize: number): { padX: number; padY: number } {
  const padX = Math.max(4, Math.min(14, Math.round(fontSize * 0.5)))
  const padY = Math.max(2, Math.min(10, Math.round(fontSize * 0.35)))
  return { padX, padY }
}

/** Heuristic: content looks like HTML (TipTap output) */
export function isNoteHtml(content: string): boolean {
  const t = content.trim()
  return t.length > 0 && (t.startsWith('<p>') || t.startsWith('<div') || t.startsWith('<span'))
}

/**
 * Parse HTML (e.g. from TipTap) into lines and segments for canvas rendering.
 */
export function htmlToSegments(html: string, defaultFontSize: number): ParsedLine[] {
  // Parse in an inert document: note HTML comes from project files and shared
  // projects, and elements created in the live document load images and fire
  // their event handlers (e.g. <img onerror>) even while detached.
  const doc = typeof document !== 'undefined' ? document.implementation.createHTMLDocument('') : null
  if (!doc) {
    return [
      {
        segments: [{ text: html.replace(/<[^>]*>/g, ''), bold: false, italic: false, underline: false }],
        lineHeight: defaultFontSize * NOTE_CANVAS_LINE_HEIGHT_MULT,
      },
    ]
  }
  const el = doc.createElement('div')
  el.innerHTML = html

  const lines: ParsedLine[] = []
  const blockTags = ['P', 'DIV']

  /** Collect one or more lines from a block; multiple lines when block contains <br>. */
  const collectLineSegments = (container: Element): ParsedLine[] => {
    const result: ParsedLine[] = []
    let segments: TextSegment[] = []

    const flushLine = () => {
      if (segments.length === 0) segments.push({ text: '', bold: false, italic: false, underline: false })
      const lineFontMax = segments.reduce((m, s) => Math.max(m, s.fontSize ?? defaultFontSize), 0)
      const effMax = lineFontMax > 0 ? lineFontMax : defaultFontSize
      result.push({ segments, lineHeight: effMax * NOTE_CANVAS_LINE_HEIGHT_MULT })
      segments = []
    }

    const visit = (node: Node, bold: boolean, italic: boolean, underline: boolean, fontSize: number) => {
      if (node.nodeType === Node.TEXT_NODE) {
        const text = node.textContent || ''
        if (text) {
          segments.push({ text, bold, italic, underline, fontSize: fontSize !== defaultFontSize ? fontSize : undefined })
        }
        return
      }
      if (node.nodeType !== Node.ELEMENT_NODE) return
      const elem = node as HTMLElement
      const tag = elem.tagName.toUpperCase()
      if (tag === 'BR') {
        flushLine()
        return
      }
      let nextBold = bold
      let nextItalic = italic
      let nextUnderline = underline
      let nextFontSize = fontSize
      if (tag === 'STRONG' || tag === 'B') nextBold = true
      else if (tag === 'EM' || tag === 'I') nextItalic = true
      else if (tag === 'U') nextUnderline = true
      else if (tag === 'SPAN' && elem.getAttribute('style')) {
        const m = elem.getAttribute('style')?.match(/font-size:\s*(\d+)px/)
        if (m && m[1]) nextFontSize = parseInt(m[1], 10)
      }
      elem.childNodes.forEach((child) => visit(child, nextBold, nextItalic, nextUnderline, nextFontSize))
    }
    container.childNodes.forEach((child) => visit(child, false, false, false, defaultFontSize))
    flushLine()
    return result
  }

  const hasBlockChildren = (node: Node): boolean => {
    return Array.from(node.childNodes).some(
      (c) => c.nodeType === Node.ELEMENT_NODE && blockTags.includes((c as Element).tagName.toUpperCase())
    )
  }

  const walkBlocks = (node: Node): void => {
    if (node.nodeType === Node.ELEMENT_NODE) {
      const elem = node as Element
      const tag = elem.tagName.toUpperCase()
      if (tag === 'BR') {
        lines.push({
          segments: [{ text: '', bold: false, italic: false, underline: false }],
          lineHeight: defaultFontSize * NOTE_CANVAS_LINE_HEIGHT_MULT,
        })
        return
      }
      if (blockTags.includes(tag)) {
        // If this block contains direct block children (e.g. div wrapping multiple <p>), recurse so each becomes its own line
        if (hasBlockChildren(node)) {
          node.childNodes.forEach(walkBlocks)
          return
        }
        lines.push(...collectLineSegments(elem))
        return
      }
    }
    node.childNodes.forEach(walkBlocks)
  }

  if (el.children.length === 0) {
    const parts = el.innerHTML.split(/<br\s*\/?>/gi)
    parts.forEach((part) => {
      const lineEl = doc.createElement('div')
      lineEl.innerHTML = part
      lines.push(...collectLineSegments(lineEl))
    })
  } else {
    walkBlocks(el)
  }
  if (lines.length === 0) {
    lines.push({
      segments: [{ text: '', bold: false, italic: false, underline: false }],
      lineHeight: defaultFontSize * NOTE_CANVAS_LINE_HEIGHT_MULT,
    })
  }
  return lines
}

/**
 * Parse note content (HTML or legacy markdown) into lines for canvas.
 */
export function noteContentToLines(content: string, defaultFontSize: number): ParsedLine[] {
  return isNoteHtml(content) ? htmlToSegments(content, defaultFontSize) : parseMarkdown(content, defaultFontSize)
}

/**
 * Parse markdown text into segments with formatting (legacy notes).
 */
export function parseMarkdown(text: string, defaultFontSize: number): ParsedLine[] {
  const lines = text.split('\n')
  
  return lines.map(line => {
    const segments: TextSegment[] = []
    let currentPos = 0
    
    // Parse the line character by character
    while (currentPos < line.length) {
      const segment = parseSegment(line, currentPos, defaultFontSize)
      if (segment) {
        segments.push(segment.segment)
        currentPos = segment.newPos
      } else {
        // Fallback: add remaining text as plain segment
        segments.push({
          text: line.slice(currentPos),
          bold: false,
          italic: false,
          underline: false,
        })
        break
      }
    }
    
    // If no segments, add empty segment
    if (segments.length === 0) {
      segments.push({
        text: '',
        bold: false,
        italic: false,
        underline: false,
      })
    }

    const lineFontMax = segments.reduce((m, s) => Math.max(m, s.fontSize ?? defaultFontSize), 0)
    const effMax = lineFontMax > 0 ? lineFontMax : defaultFontSize

    return {
      segments,
      lineHeight: effMax * NOTE_CANVAS_LINE_HEIGHT_MULT,
    }
  })
}

function parseSegment(line: string, startPos: number, defaultFontSize: number): { segment: TextSegment; newPos: number } | null {
  let pos = startPos
  let bold = false
  let italic = false
  let underline = false
  let fontSize: number | undefined = undefined
  let text = ''
  
  // Check for opening tags
  const tagResults = checkOpeningTags(line, pos)
  bold = tagResults.bold
  italic = tagResults.italic
  underline = tagResults.underline
  fontSize = tagResults.fontSize
  pos = tagResults.newPos
  
  // If we found opening tags, find the closing tags
  if (bold || italic || underline || fontSize !== undefined) {
    const textResult = extractTextUntilClosing(line, pos, bold, italic, underline, fontSize !== undefined)
    text = textResult.text
    pos = textResult.newPos
  } else {
    // Plain text until next tag or end of line
    const nextTag = findNextTag(line, pos)
    if (nextTag !== -1) {
      text = line.slice(pos, nextTag)
      pos = nextTag
    } else {
      text = line.slice(pos)
      pos = line.length
    }
  }
  
  return {
    segment: {
      text,
      bold,
      italic,
      underline,
      fontSize: fontSize || defaultFontSize,
    },
    newPos: pos,
  }
}

function checkOpeningTags(line: string, pos: number): { bold: boolean; italic: boolean; underline: boolean; fontSize?: number; newPos: number } {
  let newPos = pos
  let bold = false
  let italic = false
  let underline = false
  let fontSize: number | undefined = undefined
  
  // Check for tags in any order
  let changed = true
  while (changed) {
    changed = false
    
    // Check for [size=N]
    const sizeMatch = line.slice(newPos).match(/^\[size=(\d+)\]/)
    if (sizeMatch && sizeMatch[1]) {
      fontSize = parseInt(sizeMatch[1], 10)
      newPos += sizeMatch[0].length
      changed = true
      continue
    }
    
    // Check for **
    if (line.slice(newPos, newPos + 2) === '**') {
      bold = true
      newPos += 2
      changed = true
      continue
    }
    
    // Check for __
    if (line.slice(newPos, newPos + 2) === '__') {
      underline = true
      newPos += 2
      changed = true
      continue
    }
    
    // Check for *
    if (line[newPos] === '*') {
      italic = true
      newPos += 1
      changed = true
      continue
    }
  }
  
  return { bold, italic, underline, fontSize, newPos }
}

function extractTextUntilClosing(line: string, pos: number, bold: boolean, italic: boolean, underline: boolean, hasSize: boolean): { text: string; newPos: number } {
  let text = ''
  let newPos = pos
  
  while (newPos < line.length) {
    // Check for closing tags in reverse order
    if (hasSize && line.slice(newPos, newPos + 7) === '[/size]') {
      newPos += 7
      break
    }
    
    if (bold && line.slice(newPos, newPos + 2) === '**') {
      newPos += 2
      break
    }
    
    if (underline && line.slice(newPos, newPos + 2) === '__') {
      newPos += 2
      break
    }
    
    if (italic && line[newPos] === '*') {
      newPos += 1
      break
    }
    
    text += line[newPos]
    newPos++
  }
  
  return { text, newPos }
}

function findNextTag(line: string, pos: number): number {
  const tags = ['**', '__', '*', '[size=']
  let minPos = -1
  
  for (const tag of tags) {
    const index = line.indexOf(tag, pos)
    if (index !== -1 && (minPos === -1 || index < minPos)) {
      minPos = index
    }
  }
  
  return minPos
}
