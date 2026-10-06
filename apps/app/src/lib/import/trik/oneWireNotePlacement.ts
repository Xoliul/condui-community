import { getVisibleCertificationLabelParts } from '@/lib/certificationLabels'
import { getVisibleConversionLabelParts, getVisibleEndpointNoteText } from '@/lib/conversionLabels'
import {
  DOMOTICA_BASE_HEIGHT,
  DOMOTICA_BOX_WIDTH,
  DOMOTICA_CHILD_LABEL_GAP,
  DOMOTICA_OUTPUT_SPACING,
} from '@/lib/domoticaLayout'
import { getDomoticaNoteBounds } from '@/lib/eendraad/domoticaNotes'
import type { BottomUpLayoutResult } from '@/lib/layout/bottomUpLayout'
import { measureSymbolLabelTextWidth } from '@/lib/symbolLabelTextWidth'
import type { Endpoint, Point2 } from '@/types/schema'
import { noteCanvasChromePadding, noteContentToLines } from '@/utils/noteMarkdown'

export type NoteRect = { left: number; top: number; right: number; bottom: number }
export type NoteSegment = { startPoint: Point2; endPoint: Point2 }

const SYMBOL_SIZE = 30
const ENDPOINT_TEXT_FONT_SIZE = 8
const ENDPOINT_TEXT_LINE_HEIGHT = 10
const LABEL_FONT_SIZE = 11
const NOTE_CLEARANCE = 3
const SEARCH_STEP = 10
const SEARCH_RADIUS = 400

/** Painted box of a canvas note whose text origin is `pos` (matches NoteSymbol). */
export function getNoteBox(text: string, fontSize: number): { offsetX: number; offsetY: number; width: number; height: number } {
  const lines = noteContentToLines(text || ' ', fontSize)
  const { padX, padY } = noteCanvasChromePadding(fontSize)
  const width = Math.max(
    0,
    ...lines.map((line) =>
      line.segments.reduce((sum, segment) => sum + segment.text.length * (segment.fontSize || fontSize) * 0.6, 0)
    )
  )
  const height = lines.reduce((sum, line) => sum + line.lineHeight, 0)
  return { offsetX: -padX, offsetY: -padY, width: width + padX * 2, height: height + padY * 2 }
}

function rectsOverlap(a: NoteRect, b: NoteRect, clearance: number): boolean {
  return !(
    a.right + clearance <= b.left ||
    a.left >= b.right + clearance ||
    a.bottom + clearance <= b.top ||
    a.top >= b.bottom + clearance
  )
}

/** Wires are axis-aligned; treat each one as a thin rectangle. */
function segmentRect(segment: NoteSegment): NoteRect {
  return {
    left: Math.min(segment.startPoint.x, segment.endPoint.x) - 1,
    right: Math.max(segment.startPoint.x, segment.endPoint.x) + 1,
    top: Math.min(segment.startPoint.y, segment.endPoint.y) - 1,
    bottom: Math.max(segment.startPoint.y, segment.endPoint.y) + 1,
  }
}

function getEndpointTextLines(endpoint: Endpoint): string[] {
  return [
    ...getVisibleConversionLabelParts(endpoint).map((part) => part.text),
    ...getVisibleCertificationLabelParts(endpoint).map((part) => part.text),
    getVisibleEndpointNoteText(endpoint),
  ]
    .flatMap((text) => text.split(/\r\n?|\n/))
    .filter((line) => line.trim().length > 0)
}

function getEndpointRects(endpoint: Endpoint, center: Point2): NoteRect[] {
  const rects: NoteRect[] = []
  if (endpoint.symbol === 'domotica') {
    const outputs = Math.max(1, endpoint.domoticaProps?.endpointCount ?? 1)
    rects.push({
      left: center.x - DOMOTICA_BOX_WIDTH / 2,
      right: center.x + DOMOTICA_BOX_WIDTH / 2,
      top: center.y - (outputs - 1) * DOMOTICA_OUTPUT_SPACING - DOMOTICA_BASE_HEIGHT / 2,
      bottom: center.y + DOMOTICA_BASE_HEIGHT / 2,
    })
    const note = getDomoticaNoteBounds(endpoint, center.x, center.y, center.x)
    if (note) rects.push(note)
  } else {
    rects.push({
      left: center.x - SYMBOL_SIZE / 2,
      right: center.x + SYMBOL_SIZE / 2,
      top: center.y - SYMBOL_SIZE / 2,
      bottom: center.y + SYMBOL_SIZE / 2,
    })
    const lines = getEndpointTextLines(endpoint)
    if (lines.length > 0) {
      const width = Math.max(...lines.map((line) => measureSymbolLabelTextWidth(line, 'Figtree', ENDPOINT_TEXT_FONT_SIZE)))
      const top = center.y + SYMBOL_SIZE / 2 + 2
      rects.push({
        left: center.x - width / 2,
        right: center.x + width / 2,
        top,
        bottom: top + lines.length * ENDPOINT_TEXT_LINE_HEIGHT,
      })
    }
  }
  // Domotica output rows print their label right of the row's last symbol.
  if (endpoint.domoticaChildProps && endpoint.label.trim()) {
    const left = center.x + SYMBOL_SIZE / 2 + DOMOTICA_CHILD_LABEL_GAP
    rects.push({
      left,
      right: left + measureSymbolLabelTextWidth(endpoint.label.trim(), 'Figtree', LABEL_FONT_SIZE),
      top: center.y - LABEL_FONT_SIZE,
      bottom: center.y + 4,
    })
  }
  return rects
}

/** Painted one-wire content that imported notes must not cover. */
export function collectOneWireNoteObstacles(
  layout: BottomUpLayoutResult,
  endpointsById: Map<string, Endpoint>,
  endpointCenters: Map<string, Point2>,
  wires: NoteSegment[]
): { rects: NoteRect[]; frames: NoteRect[] } {
  const rects: NoteRect[] = wires.map(segmentRect)
  for (const [endpointId, center] of endpointCenters) {
    const endpoint = endpointsById.get(endpointId)
    if (endpoint) rects.push(...getEndpointRects(endpoint, center))
  }
  const frames: NoteRect[] = []
  for (const panelLayout of layout.panels) {
    let frame: NoteRect | undefined
    for (const element of panelLayout.elements) {
      const { x, y } = element.position
      if (element.type === 'endpoint') {
        // Endpoints come from endpointCenters, which also covers converter output chains.
      } else if (element.type === 'label') {
        const text = element.label?.trim()
        if (text && element.notesVisible !== false) {
          const width = measureSymbolLabelTextWidth(text, 'Figtree', LABEL_FONT_SIZE)
          rects.push({ left: x - width / 2, right: x + width / 2, top: y - LABEL_FONT_SIZE, bottom: y + 4 })
        }
      } else if (element.type !== 'trunk' && element.type !== 'branch' && element.type !== 'mainBus') {
        const width = element.width ?? SYMBOL_SIZE
        const height = element.height ?? SYMBOL_SIZE
        rects.push({ left: x - width / 2, right: x + width / 2, top: y - height / 2, bottom: y + height / 2 })
      }
      frame = frame
        ? {
            left: Math.min(frame.left, x - SYMBOL_SIZE),
            right: Math.max(frame.right, x + SYMBOL_SIZE),
            top: Math.min(frame.top, y - SYMBOL_SIZE),
            bottom: Math.max(frame.bottom, y + SYMBOL_SIZE),
          }
        : { left: x - SYMBOL_SIZE, right: x + SYMBOL_SIZE, top: y - SYMBOL_SIZE, bottom: y + SYMBOL_SIZE }
    }
    if (frame) frames.push(frame)
  }
  return { rects, frames }
}

function getSearchOffsets(): Point2[] {
  const offsets: Point2[] = []
  const rings = Math.ceil(SEARCH_RADIUS / SEARCH_STEP)
  for (let dy = -rings; dy <= rings; dy += 1) {
    for (let dx = -rings; dx <= rings; dx += 1) {
      offsets.push({ x: dx * SEARCH_STEP, y: dy * SEARCH_STEP })
    }
  }
  return offsets.sort((a, b) => a.x * a.x + a.y * a.y - (b.x * b.x + b.y * b.y))
}

export type NotePlacementRequest = {
  /** Requested text origin, as TRiK placed the note. */
  desired: Point2
  box: { offsetX: number; offsetY: number; width: number; height: number }
}

/**
 * Moves each note to the nearest free spot around its requested position so imported
 * text never covers symbols, labels, wires or earlier notes. A note that finds no free
 * spot nearby is stacked below the drawing it belongs to.
 */
export function placeNotesAvoiding(
  requests: NotePlacementRequest[],
  obstacles: NoteRect[],
  frames: NoteRect[] = []
): Point2[] {
  const offsets = getSearchOffsets()
  const occupied = [...obstacles]
  const overflowBottomByFrame = new Map<number, number>()
  return requests.map(({ desired, box }) => {
    const rectAt = (pos: Point2): NoteRect => ({
      left: pos.x + box.offsetX,
      top: pos.y + box.offsetY,
      right: pos.x + box.offsetX + box.width,
      bottom: pos.y + box.offsetY + box.height,
    })
    const isFree = (rect: NoteRect) => !occupied.some((other) => rectsOverlap(rect, other, NOTE_CLEARANCE))
    for (const offset of offsets) {
      const pos = { x: desired.x + offset.x, y: desired.y + offset.y }
      const rect = rectAt(pos)
      if (isFree(rect)) {
        occupied.push(rect)
        return pos
      }
    }
    const frameIndex = Math.max(
      0,
      frames.findIndex(
        (frame) => desired.x >= frame.left && desired.x <= frame.right && desired.y >= frame.top && desired.y <= frame.bottom
      )
    )
    const frame = frames[frameIndex]
    const bottom = overflowBottomByFrame.get(frameIndex) ?? Math.max(frame?.bottom ?? desired.y, ...occupied.map((rect) => (frame && rect.left <= frame.right && rect.right >= frame.left ? rect.bottom : -Infinity)))
    const pos = { x: (frame?.left ?? desired.x) - box.offsetX, y: bottom + NOTE_CLEARANCE * 2 - box.offsetY }
    const rect = rectAt(pos)
    occupied.push(rect)
    overflowBottomByFrame.set(frameIndex, rect.bottom)
    return pos
  })
}
