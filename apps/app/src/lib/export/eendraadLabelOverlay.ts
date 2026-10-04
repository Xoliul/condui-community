import { jsPDF } from 'jspdf'
import type { BottomUpPanelLayout } from '@/lib/layout/bottomUpLayout'
import { estimateProtectionNameLabelWidth, LAYOUT_CONSTANTS } from '@/lib/layout/bottomUpLayout'
import {
  CIRCUIT_NOTES_FONT_SIZE,
  CIRCUIT_NOTES_LINE_HEIGHT,
  CIRCUIT_NOTES_VERTICAL_X_NUDGE,
  estimateCircuitNotesRenderedWidth,
  estimateCircuitNotesWidth,
  getCircuitNotesVisualLines,
  measureCircuitNotesLineWidth,
  normalizeCircuitNotesText,
} from '@/lib/layout/circuitNoteMetrics'
import type { ExportTheme, SceneBounds, ComposedPagePlacement } from './types'
import type { Note, WireSegment } from '@/types/schema'
import { noteContentToLines } from '@/utils/noteMarkdown'
import { getThemeColors } from '@/lib/theme/colors'
import { getExportFontFamily } from './fontPostProcessor'
import {
  isFireClassLabelVisibleForSegment,
  isWireLabelVisibleForSegment,
  isWireLengthLabelVisibleForSegment,
} from '@/lib/wireLabelVisibility'
import {
  computeVerticalWireLabelLayout,
  computeVerticalWireLabelStackLayout,
  formatWireLabel,
  getWireFireClassLabel,
  getWireLabelAlignForSegment,
  getWireLabelOffsetAlongWire,
  isMainSupplyVerticalWireSegment,
  WIRE_LABEL_DISTANCE_FROM_WIRE,
  WIRE_LABEL_FONT_SIZE,
} from '@/lib/wireTextLabel'
import { getWireLengthLabel } from '@/lib/wires/wireFingerprint'
import { getSubPanelIncomingFeedLabelAnchors } from '@/lib/layout/layoutTree'
import i18n from '@/i18n'
import { exportLog } from './exportLogger'

const LABEL_FONT_SIZE = 11
/** Parent panel name on sub-panel feeder (matches layoutTree visual / panel canvas secondary line). */
const SUBPANEL_PARENT_TAG_FONT_SIZE = 10
/** PDF-only extra gap so rotated specs clear the drop; canvas already uses DISTANCE_FROM_WIRE. */
const WIRE_LABEL_PDF_DISTANCE_NUDGE_PX = 2
const LABEL_Y_OFFSET = 8
const NOTES_FONT_SIZE = 10
const SECONDARY_BUS_REFERENCE_FONT_SIZE = 8
const SECONDARY_BUS_REFERENCE_Y_OFFSET = 10
const SECONDARY_BUS_REFERENCE_TEXT_CHAR_WIDTH = 0.62
const SECONDARY_BUS_REFERENCE_MIN_TEXT_WIDTH = 10
const SECONDARY_BUS_REFERENCE_TEXT_GAP = 7
const SECONDARY_BUS_REFERENCE_ARROW_LENGTH = 22

interface CircuitNoteLinePlacement {
  text: string
  x: number
  y: number
  width: number
  rotationDeg: number
}

function getCircuitNoteLinePlacements(params: {
  text: string
  x: number
  y: number
  orientation: 'horizontal' | 'vertical'
  fontFamily: string
}): CircuitNoteLinePlacement[] {
  const text = normalizeCircuitNotesText(params.text)
  const wrappingWidth = estimateCircuitNotesWidth(
    text,
    params.fontFamily,
    CIRCUIT_NOTES_FONT_SIZE
  )
  const lines = getCircuitNotesVisualLines(
    text,
    params.fontFamily,
    CIRCUIT_NOTES_FONT_SIZE,
    wrappingWidth
  )
  const renderedWidth = estimateCircuitNotesRenderedWidth(
    text,
    params.fontFamily,
    CIRCUIT_NOTES_FONT_SIZE
  )
  const blockHeight = lines.length * CIRCUIT_NOTES_LINE_HEIGHT
  const isVertical = params.orientation === 'vertical'
  const groupX = params.x + (isVertical ? CIRCUIT_NOTES_VERTICAL_X_NUDGE : 0)
  const groupY = isVertical ? params.y - renderedWidth / 2 : params.y
  const textTop = isVertical
    ? -blockHeight / 2
    : -blockHeight + CIRCUIT_NOTES_LINE_HEIGHT / 2

  return lines.map((line, index) => {
    const width = measureCircuitNotesLineWidth(
      line,
      params.fontFamily,
      CIRCUIT_NOTES_FONT_SIZE
    )
    const localCenterY =
      textTop + index * CIRCUIT_NOTES_LINE_HEIGHT + CIRCUIT_NOTES_FONT_SIZE / 2
    return isVertical
      ? {
          text: line,
          x: groupX + localCenterY,
          y: groupY + width / 2,
          width,
          rotationDeg: -90,
        }
      : {
          text: line,
          x: groupX - width / 2,
          y: groupY + localCenterY,
          width,
          rotationDeg: 0,
        }
  })
}
const SECONDARY_BUS_REFERENCE_ARROW_HEAD_LENGTH = 6
const SECONDARY_BUS_REFERENCE_ARROW_HEAD_HALF_HEIGHT = 3
const SECONDARY_BUS_REFERENCE_STROKE_WIDTH = 1.2
const MM_PER_INCH = 25.4
const PT_PER_INCH = 72

type PdfBaseline = 'alphabetic' | 'top' | 'middle' | 'bottom'
type PdfTextOptions = NonNullable<Parameters<jsPDF['text']>[3]>
type PdfTextOptionsWithAngle = PdfTextOptions & { angle?: number }
type PdfWithOptionalGraphicsApi = jsPDF & {
  saveGraphicsState?: () => void
  restoreGraphicsState?: () => void
  rotate?: (angle: number, x: number, y: number) => void
  getTextDimensions?: (text: string) => { h?: number }
  setLineCap?: (style: 'butt' | 'round' | 'square') => void
  setLineJoin?: (style: 'miter' | 'round' | 'bevel') => void
}

export type ExportLabelKind =
  | 'circuit-top'
  | 'branch'
  | 'technical-spec'
  | 'circuit-note'
  | 'free-note'
  | 'wire-label'
  | 'secondary-bus-reference'
  | 'subpanel-tag'
  | 'other'

export interface ExportTextOverlay {
  id: string
  kind: ExportLabelKind
  circuitId?: string

  text: string

  // Scene space
  x: number
  y: number

  // Style
  fontSize: number
  fontStyle?: 'normal' | 'italic' | 'bold' | 'bolditalic'
  color?: string

  // Layout
  align?: 'left' | 'center' | 'right'
  rotationDeg?: number

  // Debug / optional
  estimatedWidthPx?: number
  estimatedHeightPx?: number

  notesVisible?: boolean

  /** Wire/branch/protection column X used for slice clip tests (scene space). */
  columnX?: number

  debugWireStart?: { x: number; y: number }
  debugWireEnd?: { x: number; y: number }
  debugWireLabelOrigin?: { x: number; y: number }
  debugWireLabelBase?: { x: number; y: number }
  debugDistanceFromWire?: number
  debugOffsetAlongWire?: number
}

/** Right edge of a centered circuit code, matching CircuitLabel's center box. */
function getCenteredCircuitLabelRight(x: number, text: string): number {
  const width = Math.max(24, estimateProtectionNameLabelWidth(text))
  return x + width / 2
}

function getBaselineForOverlay(kind: ExportLabelKind): PdfBaseline {
  switch (kind) {
    case 'circuit-note':
      // Circuit notes are anchored by their visual centre on canvas.
      return 'middle'
    case 'free-note':
      // Free notes and labels on canvas use a hanging/top baseline.
      return 'top'
    case 'circuit-top':
    case 'branch':
    case 'technical-spec':
    case 'subpanel-tag':
    case 'secondary-bus-reference':
    case 'other':
    default:
      return 'top'
  }
}

export function collectEendraadTextOverlays(
  panelLayout: BottomUpPanelLayout,
  exportTheme: ExportTheme,
): ExportTextOverlay[] {
  const overlays: ExportTextOverlay[] = []
  const colors = getThemeColors(exportTheme)
  const fontFamily = getExportFontFamily()

  const subPanelFeedAnchors = getSubPanelIncomingFeedLabelAnchors(panelLayout)
  const protectionXByCircuitId = new Map<string, number>()
  const circuitLabelByCircuitId = new Map<string, { x: number; text: string }>()
  for (const el of panelLayout.elements) {
    if (el.type === 'protection' && el.circuitId) {
      protectionXByCircuitId.set(el.circuitId, el.position.x)
    }
  }
  for (const el of panelLayout.elements) {
    if (el.type !== 'label' || el.branchId || el.id?.startsWith('circuit-notes-') || !el.circuitId) {
      continue
    }
    const text = (el.translationKey ? i18n.t(el.translationKey) : (el.label ?? '')).trim()
    if (!text) continue
    circuitLabelByCircuitId.set(el.circuitId, { x: el.position.x, text })
  }

  for (const el of panelLayout.elements) {
    if (el.type !== 'label') continue
    // Legacy circuit-notes labels are represented both in elements and in panelLayout.circuitNotes.
    // To avoid double ownership, ignore these here and rely on circuitNotes as the single source.
    if (el.id?.startsWith('circuit-notes-')) continue
    const text = (el.translationKey ? i18n.t(el.translationKey) : (el.label ?? '')).trim()
    if (!text) continue

    const isBranchLabel = !!el.branchId
    const isParentMcbFeedLabel = el.id === 'parent-mcb-label'
    const isParentPanelTag = el.id?.startsWith('parent-tag-') ?? false

    if (subPanelFeedAnchors && isParentMcbFeedLabel) {
      overlays.push({
        id: el.id,
        kind: 'circuit-top',
        circuitId: el.circuitId,
        text,
        x: subPanelFeedAnchors.centerX,
        y: subPanelFeedAnchors.circuitAnchorY - LABEL_Y_OFFSET,
        columnX: subPanelFeedAnchors.centerX,
        fontSize: LABEL_FONT_SIZE,
        fontStyle: 'normal',
        color: colors.textColor,
        align: 'center',
      })
      continue
    }

    if (subPanelFeedAnchors && isParentPanelTag) {
      overlays.push({
        id: el.id,
        kind: 'subpanel-tag',
        text,
        x: subPanelFeedAnchors.centerX,
        y: subPanelFeedAnchors.parentTagAnchorY - LABEL_Y_OFFSET,
        columnX: subPanelFeedAnchors.centerX,
        fontSize: SUBPANEL_PARENT_TAG_FONT_SIZE,
        fontStyle: 'normal',
        color: colors.textColor,
        align: 'center',
      })
      continue
    }

    const kind: ExportLabelKind = isBranchLabel ? 'branch' : 'circuit-top'
    const columnX = isBranchLabel
      ? el.position.x + LAYOUT_CONSTANTS.LABEL_OFFSET
      : (el.circuitId ? protectionXByCircuitId.get(el.circuitId) : undefined) ??
        el.position.x
    const circuitLabel = el.circuitId ? circuitLabelByCircuitId.get(el.circuitId) : undefined
    const x =
      isBranchLabel && circuitLabel
        ? getCenteredCircuitLabelRight(circuitLabel.x, circuitLabel.text)
        : el.position.x

    overlays.push({
      id: el.id,
      kind,
      circuitId: el.circuitId,
      text,
      x,
      y: el.position.y - LABEL_Y_OFFSET,
      columnX,
      fontSize: LABEL_FONT_SIZE,
      fontStyle: 'normal',
      color: colors.textColor,
      align: isBranchLabel ? 'right' : 'center',
    })
  }

  if (panelLayout.circuitNotes && panelLayout.circuitNotes.length > 0) {
    for (const note of panelLayout.circuitNotes) {
      const text = normalizeCircuitNotesText(note.label)
      if (!text || note.notesVisible === false) continue

      const placements = getCircuitNoteLinePlacements({
        text,
        x: note.x,
        y: note.y,
        orientation: note.notesOrientation ?? 'horizontal',
        fontFamily,
      })
      placements.forEach((placement, index) => {
        overlays.push({
          id: `circuit-notes-${note.circuitId}-${index}`,
          kind: 'circuit-note',
          circuitId: note.circuitId,
          text: placement.text,
          x: placement.x,
          y: placement.y,
          fontSize: NOTES_FONT_SIZE,
          fontStyle: 'italic',
          color: colors.secondaryText ?? colors.textColor,
          align: 'left',
          rotationDeg: placement.rotationDeg,
          estimatedWidthPx: placement.width,
          estimatedHeightPx: CIRCUIT_NOTES_FONT_SIZE,
          notesVisible: note.notesVisible,
        })
      })
    }
  }

  // Dedupe overlays by semantic key so each logical label is only emitted once.
  const seen = new Set<string>()
  const deduped: ExportTextOverlay[] = []

  for (const o of overlays) {
    const key = [
      o.kind,
      o.circuitId ?? '',
      o.text.trim(),
      Math.round(o.x),
      Math.round(o.y),
      o.rotationDeg ?? 0,
    ].join('|')
    if (seen.has(key)) continue
    seen.add(key)
    deduped.push(o)
  }

  return deduped
}

export function collectEendraadFreeNoteOverlays(
  notes: Note[] | undefined,
  panelId: string,
  exportTheme: ExportTheme,
): ExportTextOverlay[] {
  if (!notes || notes.length === 0) return []
  const colors = getThemeColors(exportTheme)
  const overlays: ExportTextOverlay[] = []

  for (const note of notes) {
    if (note.panelId && note.panelId !== panelId) continue
    const raw = (note.text ?? '').trim()
    if (!raw) continue

    overlays.push({
      id: `free-note-${note.id}`,
      kind: 'free-note',
      text: raw,
      x: note.pos.x,
      y: note.pos.y,
      fontSize: note.fontSize || 12,
      fontStyle: 'normal',
      color: colors.textColor,
      align: 'left',
    })
  }

  return overlays
}

export function collectEendraadWireLabelOverlays(
  wireSegments: WireSegment[],
  panelId: string,
  exportTheme: ExportTheme,
  diagramId: string = panelId,
): ExportTextOverlay[] {
  if (!wireSegments.length) return []

  const colors = getThemeColors(exportTheme)
  const fontFamily = getExportFontFamily()
  const overlays: ExportTextOverlay[] = []

  for (const wireSegment of wireSegments) {
    if (wireSegment.panelId !== panelId) continue
    if ((wireSegment.diagramId ?? wireSegment.panelId) !== diagramId) continue
    if (!isWireLabelVisibleForSegment(wireSegment)) continue

    const mainText = formatWireLabel(wireSegment, {
      otherLabel: i18n.t('wires.other'),
      batteryCableLabel: i18n.t('wires.batteryCable', 'Battery cable'),
    })
    const fireClassText = isFireClassLabelVisibleForSegment(wireSegment)
      ? getWireFireClassLabel(wireSegment.cable)
      : undefined
    const wireLengthText = isWireLengthLabelVisibleForSegment(wireSegment)
      ? getWireLengthLabel(wireSegment)
      : undefined
    const offsetAlongWire = getWireLabelOffsetAlongWire(wireSegment)
    const labelAlign = getWireLabelAlignForSegment(wireSegment)
    const labelEndPoint = wireSegment.wireLabelBaseEndPoint ?? wireSegment.wireLabelEndPoint ?? wireSegment.endPoint
    const exportLabelOrigin = getExportWireLabelOrigin(wireSegment, wireSegments)
    const debugWireLabelOrigin = exportLabelOrigin
    const debugWireLabelBase = getWireLabelBasePointForDebug(
      wireSegment,
      offsetAlongWire,
      exportLabelOrigin,
    )

    if (fireClassText || wireLengthText) {
      const stackLayout = computeVerticalWireLabelStackLayout({
        mainText,
        fireClassText,
        wireLengthText,
        startPoint: wireSegment.startPoint,
        endPoint: labelEndPoint,
        fontFamily,
        fontSize: WIRE_LABEL_FONT_SIZE,
        align: labelAlign,
        distanceFromWire: WIRE_LABEL_DISTANCE_FROM_WIRE,
        offsetAlongWire,
      })
      if (!stackLayout?.main.renderedText) continue

      const stackAnchorX =
        exportLabelOrigin.x + (stackLayout.anchorX - wireSegment.startPoint.x)
      const stackAnchorY = exportLabelOrigin.y + offsetAlongWire
      // Konva rotates the stack -90° around the group origin, so each line's
      // world X is anchorX + line.y + fontSize/2 (to the right of the wire).
      const mainLabelX =
        stackAnchorX +
        stackLayout.main.y +
        WIRE_LABEL_FONT_SIZE / 2 +
        WIRE_LABEL_PDF_DISTANCE_NUDGE_PX

      const pushStackLine = (
        suffix: string,
        line: { renderedText: string; textWidth: number; y: number },
      ) => {
        const labelX = mainLabelX + (line.y - stackLayout.main.y)
        overlays.push({
          id: `wire-label-${wireSegment.id}-${suffix}`,
          kind: 'wire-label',
          circuitId: wireSegment.circuitId,
          text: line.renderedText,
          x: labelX,
          y: stackAnchorY,
          fontSize: WIRE_LABEL_FONT_SIZE,
          fontStyle: 'normal',
          color: colors.wireColor,
          align: 'center',
          rotationDeg: -90,
          estimatedWidthPx: line.textWidth,
          estimatedHeightPx: WIRE_LABEL_FONT_SIZE,
          debugWireStart: wireSegment.startPoint,
          debugWireEnd: wireSegment.endPoint,
          debugWireLabelOrigin,
          debugWireLabelBase,
          debugDistanceFromWire: labelX - debugWireLabelBase.x,
          debugOffsetAlongWire: offsetAlongWire,
        })
      }

      pushStackLine('main', stackLayout.main)
      if (stackLayout.fireClass) pushStackLine('fire', stackLayout.fireClass)
      if (stackLayout.wireLength) pushStackLine('length', stackLayout.wireLength)
      continue
    }

    const layout = computeVerticalWireLabelLayout({
      text: mainText,
      startPoint: wireSegment.startPoint,
      endPoint: labelEndPoint,
      fontFamily,
      fontSize: WIRE_LABEL_FONT_SIZE,
      align: labelAlign,
      distanceFromWire: WIRE_LABEL_DISTANCE_FROM_WIRE,
      offsetAlongWire,
    })

    if (!layout?.renderedText) continue
    const labelX =
      exportLabelOrigin.x +
      (layout.anchorX - wireSegment.startPoint.x) +
      WIRE_LABEL_PDF_DISTANCE_NUDGE_PX
    const labelY = exportLabelOrigin.y + offsetAlongWire

    overlays.push({
      id: `wire-label-${wireSegment.id}`,
      kind: 'wire-label',
      circuitId: wireSegment.circuitId,
      text: layout.renderedText,
      x: labelX,
      y: labelY,
      fontSize: WIRE_LABEL_FONT_SIZE,
      fontStyle: 'normal',
      color: colors.wireColor,
      align: 'center',
      rotationDeg: -90,
      estimatedWidthPx: layout.textWidth,
      estimatedHeightPx: layout.textHeight,
      debugWireStart: wireSegment.startPoint,
      debugWireEnd: wireSegment.endPoint,
      debugWireLabelOrigin,
      debugWireLabelBase,
      debugDistanceFromWire: labelX - debugWireLabelBase.x,
      debugOffsetAlongWire: offsetAlongWire,
    })
  }

  return overlays
}

function estimateSecondaryBusReferenceTextWidth(text: string): number {
  return Math.max(
    SECONDARY_BUS_REFERENCE_MIN_TEXT_WIDTH,
    text.length * SECONDARY_BUS_REFERENCE_FONT_SIZE * SECONDARY_BUS_REFERENCE_TEXT_CHAR_WIDTH
  )
}

export function collectEendraadSecondaryBusReferenceOverlays(
  wireSegments: WireSegment[],
  panelId: string,
  exportTheme: ExportTheme,
  sliceBounds: SceneBounds,
  diagramId: string = panelId,
): ExportTextOverlay[] {
  if (!wireSegments.length) return []

  const colors = getThemeColors(exportTheme)
  const groups = new Map<
    string,
    {
      label: string
      y: number
      left: number
      right: number
      markerXs: number[]
    }
  >()

  for (const wireSegment of wireSegments) {
    if (wireSegment.panelId !== panelId) continue
    if ((wireSegment.diagramId ?? wireSegment.panelId) !== diagramId) continue
    const label = (
      wireSegment.secondaryBusReferenceExportLabel ??
      wireSegment.secondaryBusReferenceLabel ??
      ''
    ).trim()
    if (!label) continue
    if (wireSegment.startPoint.y !== wireSegment.endPoint.y) continue

    const y = wireSegment.startPoint.y
    const startX = Math.min(wireSegment.startPoint.x, wireSegment.endPoint.x)
    const endX = Math.max(wireSegment.startPoint.x, wireSegment.endPoint.x)
    const key = [
      label,
      Math.round(y * 10) / 10,
      wireSegment.circuitId ?? '',
      wireSegment.fromElementType ?? '',
      wireSegment.fromElementId ?? '',
      wireSegment.toElementType ?? '',
    ].join('|')

    const existing = groups.get(key)
    if (existing) {
      existing.left = Math.min(existing.left, startX)
      existing.right = Math.max(existing.right, endX)
      if (wireSegment.secondaryBusReferenceLabel?.trim()) existing.markerXs.push(endX)
    } else {
      groups.set(key, {
        label,
        y,
        left: startX,
        right: endX,
        markerXs: wireSegment.secondaryBusReferenceLabel?.trim() ? [endX] : [],
      })
    }
  }

  const overlays: ExportTextOverlay[] = []
  const sliceLeft = sliceBounds.x
  const sliceRight = sliceBounds.x + sliceBounds.width

  for (const [key, group] of groups) {
    if (group.right < sliceLeft || group.left > sliceRight) continue

    const textWidth = estimateSecondaryBusReferenceTextWidth(group.label)
    const labelTotalWidth =
      SECONDARY_BUS_REFERENCE_ARROW_LENGTH + SECONDARY_BUS_REFERENCE_TEXT_GAP + textWidth
    const cutContinuesIntoSlice = group.left < sliceLeft - 1 && group.right > sliceLeft + 1
    const cutAnchorX = cutContinuesIntoSlice
      ? Math.min(sliceRight - 4, sliceLeft + labelTotalWidth)
      : null

    if (cutAnchorX !== null && cutAnchorX > sliceLeft) {
      overlays.push({
        id: `secondary-bus-reference-cut-${key}-${Math.round(sliceLeft)}`,
        kind: 'secondary-bus-reference',
        text: group.label,
        x: cutAnchorX,
        y: group.y + SECONDARY_BUS_REFERENCE_Y_OFFSET,
        fontSize: SECONDARY_BUS_REFERENCE_FONT_SIZE,
        fontStyle: 'normal',
        color: colors.wireColor,
        align: 'right',
        estimatedWidthPx: textWidth,
      })
    }

    for (const markerX of group.markerXs) {
      if (markerX < sliceLeft || markerX > sliceRight) continue
      if (cutAnchorX !== null && Math.abs(markerX - cutAnchorX) < labelTotalWidth) continue
      overlays.push({
        id: `secondary-bus-reference-marker-${key}-${Math.round(markerX)}`,
        kind: 'secondary-bus-reference',
        text: group.label,
        x: markerX,
        y: group.y + SECONDARY_BUS_REFERENCE_Y_OFFSET,
        fontSize: SECONDARY_BUS_REFERENCE_FONT_SIZE,
        fontStyle: 'normal',
        color: colors.wireColor,
        align: 'right',
        estimatedWidthPx: textWidth,
      })
    }
  }

  return overlays
}

function segmentBoundsOverlapRect(
  p1: { x: number; y: number },
  p2: { x: number; y: number },
  rect: SceneBounds,
): boolean {
  const left = rect.x
  const right = rect.x + rect.width
  const top = rect.y
  const bottom = rect.y + rect.height
  const minX = Math.min(p1.x, p2.x)
  const maxX = Math.max(p1.x, p2.x)
  const minY = Math.min(p1.y, p2.y)
  const maxY = Math.max(p1.y, p2.y)
  return maxX >= left && minX <= right && maxY >= top && minY <= bottom
}

function pointOverlapsRect(x: number, y: number, rect: SceneBounds): boolean {
  return (
    x >= rect.x &&
    x <= rect.x + rect.width &&
    y >= rect.y &&
    y <= rect.y + rect.height
  )
}

/** Rough text width for anchor-based bbox checks (px). */
function estimateOverlayTextWidthPx(o: ExportTextOverlay): number {
  if (o.estimatedWidthPx != null) return o.estimatedWidthPx
  return Math.max(8, o.text.length * o.fontSize * 0.55)
}

function estimateOverlayTextHeightPx(o: ExportTextOverlay): number {
  return o.estimatedHeightPx ?? o.fontSize
}

function getOverlayColumnX(overlay: ExportTextOverlay): number {
  if (overlay.columnX != null) return overlay.columnX
  if (overlay.kind === 'branch') {
    return overlay.x + LAYOUT_CONSTANTS.LABEL_OFFSET
  }
  return overlay.x
}

/**
 * Whether an overlay should be drawn on a slice page. SVG graphics are clipped to
 * clipRect; labels offset from their wire/branch/protection column must follow the
 * same visibility rules.
 */
export function isOverlayVisibleInClip(
  overlay: ExportTextOverlay,
  clipRect: SceneBounds,
): boolean {
  switch (overlay.kind) {
    case 'wire-label': {
      if (overlay.debugWireStart && overlay.debugWireEnd) {
        return segmentBoundsOverlapRect(
          overlay.debugWireStart,
          overlay.debugWireEnd,
          clipRect,
        )
      }
      break
    }
    case 'branch':
    case 'circuit-top':
    case 'technical-spec': {
      const columnX = getOverlayColumnX(overlay)
      return pointOverlapsRect(columnX, overlay.y, clipRect)
    }
    case 'subpanel-tag':
      return pointOverlapsRect(overlay.x, overlay.y, clipRect)
    case 'circuit-note': {
      const textWidth = estimateOverlayTextWidthPx(overlay)
      const textHeight = estimateOverlayTextHeightPx(overlay)

      // Circuit-note placements are line-level anchors. Horizontal lines use a
      // left/center anchor at the visual midpoint; rotated lines use a left edge
      // plus a middle baseline before the -90° transform. Keep the bbox in the
      // same scene space as the slice clip so notes crossing a page seam remain
      // eligible for the adjacent slice.
      if ((overlay.rotationDeg ?? 0) !== 0) {
        return segmentBoundsOverlapRect(
          { x: overlay.x - textHeight / 2, y: overlay.y - textWidth },
          { x: overlay.x + textHeight / 2, y: overlay.y },
          clipRect,
        )
      }

      return segmentBoundsOverlapRect(
        { x: overlay.x, y: overlay.y - textHeight / 2 },
        { x: overlay.x + textWidth, y: overlay.y + textHeight / 2 },
        clipRect,
      )
    }
    case 'free-note':
    case 'other':
      break
    case 'secondary-bus-reference':
      return pointOverlapsRect(overlay.x, overlay.y, clipRect)
  }

  const textWidth = estimateOverlayTextWidthPx(overlay)
  const textHeight = estimateOverlayTextHeightPx(overlay)
  const align = overlay.align ?? 'left'
  let left = overlay.x
  if (align === 'center') left -= textWidth / 2
  else if (align === 'right') left -= textWidth
  const top = overlay.y
  const bbox = {
    x: left,
    y: top,
    width: textWidth,
    height: textHeight,
    space: clipRect.space,
  }
  return segmentBoundsOverlapRect(
    { x: bbox.x, y: bbox.y },
    { x: bbox.x + bbox.width, y: bbox.y + bbox.height },
    clipRect,
  )
}

export function getTextOverlaysForSlice(
  overlays: ExportTextOverlay[],
  sliceBounds: SceneBounds,
  sliceCircuitIds: string[],
  marginPx: number,
  clipRect: SceneBounds = sliceBounds,
): ExportTextOverlay[] {
  if (!overlays.length) return []
  const circuitSet = new Set(sliceCircuitIds)

  const SEAM_BIAS_PX = 4
  const left = sliceBounds.x - marginPx
  // Bias labels that sit very close to the right-hand seam toward the *next* slice
  // by shrinking the effective right edge slightly. This prevents labels whose
  // anchor is on the shared boundary from being assigned to the earlier slice.
  const rightBase = sliceBounds.x + sliceBounds.width + marginPx
  const right = Math.max(left, rightBase - SEAM_BIAS_PX)

  const result: ExportTextOverlay[] = []
  for (const o of overlays) {
    if (o.notesVisible === false) continue

    const inSliceByAnchor = o.x >= left && o.x <= right
    // Restrict circuit-based inclusion to label kinds that don't have a reliable
    // geometric anchor of their own. For regular eendraad labels we rely solely
    // on the anchor position so they don't "leak" into neighbouring slices.
    const allowCircuitBased =
      o.kind === 'subpanel-tag' || o.kind === 'other'
    const inSliceByCircuit = allowCircuitBased && o.circuitId && circuitSet.has(o.circuitId)

    if (!(inSliceByAnchor || inSliceByCircuit)) continue
    if (!isOverlayVisibleInClip(o, clipRect)) continue
    result.push(o)
  }

  return result
}

export function scenePointToPdfPoint(
  sceneX: number,
  sceneY: number,
  placement: ComposedPagePlacement,
): { x: number; y: number } {
  const { contentX, contentY, fitBounds, scale } = placement
  const pdfX = contentX + (sceneX - fitBounds.x) * scale
  const pdfY = contentY + (sceneY - fitBounds.y) * scale
  return { x: pdfX, y: pdfY }
}

function scenePxToPdfMm(valuePx: number, placement: ComposedPagePlacement): number {
  return valuePx * placement.scale
}

function scenePxToPdfFontSizePt(
  fontSizePx: number,
  placement: ComposedPagePlacement,
): number {
  return (scenePxToPdfMm(fontSizePx, placement) * PT_PER_INCH) / MM_PER_INCH
}

const DEBUG_CIRCUIT_NOTE_ANCHORS = false
const DEBUG_WIRE_LABEL_ANCHORS = false

function drawDebugCross(
  pdf: jsPDF,
  x: number,
  y: number,
  color: [number, number, number],
  size = 1.5,
): void {
  pdf.setDrawColor(color[0], color[1], color[2])
  pdf.setLineWidth(0.2)
  pdf.line(x - size, y, x + size, y)
  pdf.line(x, y - size, x, y + size)
}

function rotatePointAround(
  point: { x: number; y: number },
  origin: { x: number; y: number },
  angle: number,
): { x: number; y: number } {
  const radians = (angle * Math.PI) / 180
  const cos = Math.cos(radians)
  const sin = Math.sin(radians)
  const dx = point.x - origin.x
  const dy = point.y - origin.y
  return {
    x: origin.x + dx * cos - dy * sin,
    y: origin.y + dx * sin + dy * cos,
  }
}

export function getWireLabelPdfInsertionPoint(
  anchor: { x: number; y: number },
  textWidth: number,
  _textHeight: number,
  rotation: number,
): { x: number; y: number } {
  // jsPDF draws these labels with baseline 'middle', matching Konva's
  // offsetY = fontSize/2. Only convert the centered overlay into a
  // left-aligned insertion along the rotated text. Do not add a leftover
  // top-baseline jump in the perpendicular axis — that parks the specs
  // a full text-height (or more) away from the wire.
  return rotatePointAround(
    {
      x: anchor.x + textWidth / 2,
      y: anchor.y,
    },
    anchor,
    rotation,
  )
}

function drawDebugRotatedRectFromTopLeft(
  pdf: jsPDF,
  topLeft: { x: number; y: number },
  pivot: { x: number; y: number },
  width: number,
  height: number,
  angle: number,
  color: [number, number, number],
): void {
  const corners = [
    topLeft,
    { x: topLeft.x + width, y: topLeft.y },
    { x: topLeft.x + width, y: topLeft.y + height },
    { x: topLeft.x, y: topLeft.y + height },
  ].map((p) => rotatePointAround(p, pivot, angle))

  pdf.setDrawColor(color[0], color[1], color[2])
  pdf.setLineWidth(0.2)
  for (let i = 0; i < corners.length; i++) {
    const a = corners[i]!
    const b = corners[(i + 1) % corners.length]!
    pdf.line(a.x, a.y, b.x, b.y)
  }
}

function drawDebugCircle(
  pdf: jsPDF,
  x: number,
  y: number,
  color: [number, number, number],
  radius = 1.2,
): void {
  pdf.setDrawColor(color[0], color[1], color[2])
  pdf.setLineWidth(0.2)
  pdf.circle(x, y, radius)
}

function drawDebugLine(
  pdf: jsPDF,
  from: { x: number; y: number },
  to: { x: number; y: number },
  color: [number, number, number],
  width = 0.2,
): void {
  pdf.setDrawColor(color[0], color[1], color[2])
  pdf.setLineWidth(width)
  pdf.line(from.x, from.y, to.x, to.y)
}

function drawDebugText(
  pdf: jsPDF,
  text: string,
  x: number,
  y: number,
  color: [number, number, number],
): void {
  const pdfWithGraphics = pdf as PdfWithOptionalGraphicsApi
  if (typeof pdfWithGraphics.saveGraphicsState === 'function') pdfWithGraphics.saveGraphicsState()
  pdf.setFontSize(5)
  pdf.setTextColor(color[0], color[1], color[2])
  pdf.text(text, x, y, { align: 'left', baseline: 'middle' })
  if (typeof pdfWithGraphics.restoreGraphicsState === 'function') pdfWithGraphics.restoreGraphicsState()
}

function getVerticalWireLabelOriginForDebug(wireSegment: WireSegment): { x: number; y: number } {
  return {
    x: wireSegment.startPoint.x,
    y: (wireSegment.startPoint.y + wireSegment.endPoint.y) / 2,
  }
}

function getWireLabelBasePointForDebug(
  wireSegment: WireSegment,
  offsetAlongWire: number,
  labelOrigin?: { x: number; y: number },
): { x: number; y: number } {
  const origin = labelOrigin ?? getVerticalWireLabelOriginForDebug(wireSegment)
  return {
    x: origin.x,
    y: origin.y + offsetAlongWire,
  }
}

function getFirstBranchYForWireLabel(
  wireSegment: WireSegment,
  wireSegments: WireSegment[],
): number | null {
  if (!wireSegment.circuitId) return null
  if (wireSegment.fromElementType !== 'protection') return null
  if (wireSegment.startPoint.x !== wireSegment.endPoint.x) return null

  const x = wireSegment.startPoint.x
  const minY = Math.min(wireSegment.startPoint.y, wireSegment.endPoint.y)
  const maxY = Math.max(wireSegment.startPoint.y, wireSegment.endPoint.y)
  const branchYs: number[] = []

  for (const candidate of wireSegments) {
    if (candidate.id === wireSegment.id) continue
    if (candidate.circuitId !== wireSegment.circuitId) continue
    if (candidate.panelId !== wireSegment.panelId) continue
    if (candidate.startPoint.y !== candidate.endPoint.y) continue

    const y = candidate.startPoint.y
    const left = Math.min(candidate.startPoint.x, candidate.endPoint.x)
    const right = Math.max(candidate.startPoint.x, candidate.endPoint.x)
    if (y < minY || y > maxY) continue
    if (x < left - 0.5 || x > right + 0.5) continue
    branchYs.push(y)
  }

  if (!branchYs.length) return null
  const startY = wireSegment.startPoint.y
  branchYs.sort((a, b) => Math.abs(a - startY) - Math.abs(b - startY))
  return branchYs[0] ?? null
}

function getExportWireLabelOrigin(
  wireSegment: WireSegment,
  wireSegments: WireSegment[],
): { x: number; y: number } {
  if (isMainSupplyVerticalWireSegment(wireSegment)) {
    return {
      x: wireSegment.startPoint.x,
      y: wireSegment.startPoint.y,
    }
  }

  const labelEndPoint = wireSegment.wireLabelBaseEndPoint ?? wireSegment.wireLabelEndPoint
  if (labelEndPoint) {
    return {
      x: wireSegment.startPoint.x,
      y: (wireSegment.startPoint.y + labelEndPoint.y) / 2,
    }
  }

  const firstBranchY = getFirstBranchYForWireLabel(wireSegment, wireSegments)
  if (firstBranchY == null) return getVerticalWireLabelOriginForDebug(wireSegment)

  return {
    x: wireSegment.startPoint.x,
    y: (wireSegment.startPoint.y + firstBranchY) / 2,
  }
}

export function drawEendraadTextOverlaysOnPdf(
  pdf: jsPDF,
  overlays: ExportTextOverlay[],
  placement: ComposedPagePlacement,
  exportTheme: ExportTheme,
): void {
  if (!overlays.length) return

  const colors = getThemeColors(exportTheme)
  const fontFamily = getExportFontFamily()

  for (const o of overlays) {
    if (o.notesVisible === false) continue
    const text = o.text
    if (!text) continue

    // Circuit notes: respect the layout/canvas anchor semantics.
    // We treat (x, y) exactly as the layout does, then apply only minimal
    // baseline correction and rotation around that mapped anchor.
    if (o.kind === 'circuit-note') {
      const anchor = scenePointToPdfPoint(o.x, o.y, placement)

      const fontStyle = o.fontStyle ?? 'italic'
      const color = o.color ?? colors.secondaryText ?? colors.textColor
      const fontSize = o.fontSize

      pdf.setFont(fontFamily, fontStyle)
      pdf.setFontSize(scenePxToPdfFontSizePt(fontSize, placement))
      pdf.setTextColor(color)

      const textWidth = pdf.getTextWidth(text)
      // For circuit notes we expect vertical notes to use a -90° rotation.
      const rotation = o.rotationDeg ?? -90
      const isVertical = rotation !== 0

      // Small empirical Y correction to account for baseline differences
      // between canvas "hanging/center-ish" text and jsPDF's baseline.
      const baselineOffsetY = scenePxToPdfMm(-fontSize * 0.25, placement)

      if (DEBUG_CIRCUIT_NOTE_ANCHORS) {
        // Red cross: mapped anchor from layout.
        drawDebugCross(pdf, anchor.x, anchor.y, [255, 0, 0])
        exportLog('[Export][CircuitNote] anchor/text metrics', {
          id: o.id,
          text,
          textWidth,
          fontSize,
          isVertical,
          anchor,
        })
      }

      if (isVertical) {
        // For vertical notes we want to keep the *visual* centre of the text
        // aligned with the layout anchor. The visual height depends on glyph
        // ascenders/descenders, so we ask jsPDF for the text box height and
        // shift the insertion point on +X by half of that.
        const pdfWithGraphics = pdf as PdfWithOptionalGraphicsApi
        const dims =
          typeof pdfWithGraphics.getTextDimensions === 'function'
            ? pdfWithGraphics.getTextDimensions(text)
            : null
        const textHeight =
          (dims && typeof dims.h === 'number' && dims.h) || fontSize

        // jsPDF rotates text around the insertion point, which behaves like the
        // left-middle of the text box for horizontal text when align='left'.
        // When we rotate -90° we want the *centre* of the text to stay near
        // the layout anchor, so we shift the insertion point on +X by half the
        // measured *height* (ascenders + descenders) before rotating.
        const originX = anchor.x + textHeight / 2
        const originY = anchor.y + baselineOffsetY

        if (DEBUG_CIRCUIT_NOTE_ANCHORS) {
          // Blue cross: final text insertion point.
          drawDebugCross(pdf, originX, originY, [0, 0, 255])

          // Blue box: approximate text bounding box in PDF space, aligned
          // with the rotated text. We use getTextWidth and fontSize as a
          // proxy for width/height, with origin at the left/middle.
          if (typeof pdfWithGraphics.saveGraphicsState === 'function') {
            pdfWithGraphics.saveGraphicsState()
          }
          if (typeof pdfWithGraphics.rotate === 'function') {
            pdfWithGraphics.rotate(rotation, originX, originY)
          }
          pdf.setDrawColor(0, 0, 255)
          pdf.setLineWidth(0.2)
          pdf.rect(originX, originY - fontSize / 2, textWidth, fontSize)
          if (typeof pdfWithGraphics.restoreGraphicsState === 'function') {
            pdfWithGraphics.restoreGraphicsState()
          }
        }

        pdf.text(
          text,
          originX,
          originY,
          {
            align: 'left',
            baseline: 'middle',
            angle: -rotation,
          } satisfies PdfTextOptionsWithAngle,
        )
      } else {
        // Each line's anchor is already its left edge, centered on the circuit
        // by getCircuitNoteLinePlacements. Do not center it a second time.
        const originX = anchor.x
        const originY = anchor.y + baselineOffsetY

        if (DEBUG_CIRCUIT_NOTE_ANCHORS) {
          // Blue cross: final text insertion point.
          drawDebugCross(pdf, originX, originY, [0, 0, 255])

          // Blue box: approximate horizontal text bounding box.
          const halfH = fontSize / 2
          pdf.setDrawColor(0, 0, 255)
          pdf.setLineWidth(0.2)
          pdf.rect(originX, originY - halfH, textWidth, fontSize)
        }

        pdf.text(text, originX, originY, {
          align: 'left',
          baseline: 'middle',
        })
      }

      continue
    }

    // Free rich-text notes: render with per-segment formatting derived from noteContentToLines.
    if (o.kind === 'free-note') {
      drawFreeNoteOverlay(pdf, o, placement, fontFamily, colors.textColor)
      continue
    }

    if (o.kind === 'wire-label') {
      const anchor = scenePointToPdfPoint(o.x, o.y, placement)
      const fontStyle = o.fontStyle ?? 'normal'
      const color = o.color ?? colors.wireColor
      const rotation = -(o.rotationDeg ?? 0)
      const fontSizePt = scenePxToPdfFontSizePt(o.fontSize, placement)

      pdf.setFont(fontFamily, fontStyle)
      pdf.setFontSize(fontSizePt)
      pdf.setTextColor(color)

      const textWidth = pdf.getTextWidth(text)
      const textHeight =
        o.estimatedHeightPx != null
          ? scenePxToPdfMm(o.estimatedHeightPx, placement)
          : scenePxToPdfMm(o.fontSize, placement)
      const insertion = getWireLabelPdfInsertionPoint(anchor, textWidth, textHeight, rotation)

      if (DEBUG_WIRE_LABEL_ANCHORS) {
        const wireStart = o.debugWireStart
          ? scenePointToPdfPoint(o.debugWireStart.x, o.debugWireStart.y, placement)
          : null
        const wireEnd = o.debugWireEnd
          ? scenePointToPdfPoint(o.debugWireEnd.x, o.debugWireEnd.y, placement)
          : null
        const wireBase = o.debugWireLabelBase
          ? scenePointToPdfPoint(o.debugWireLabelBase.x, o.debugWireLabelBase.y, placement)
          : null
        const wireOrigin = o.debugWireLabelOrigin
          ? scenePointToPdfPoint(o.debugWireLabelOrigin.x, o.debugWireLabelOrigin.y, placement)
          : null

        if (wireStart && wireEnd) {
          // Green line: original wire segment used to compute this label.
          drawDebugLine(pdf, wireStart, wireEnd, [0, 160, 0], 0.35)
          drawDebugCircle(pdf, wireStart.x, wireStart.y, [0, 160, 0])
          drawDebugCross(pdf, wireEnd.x, wireEnd.y, [0, 120, 0], 1.2)
        }
        if (wireOrigin) {
          // Pale green circle: un-offset origin on the wire, normally segment midpoint.
          drawDebugCircle(pdf, wireOrigin.x, wireOrigin.y, [120, 220, 120], 1.4)
        }
        if (wireBase) {
          // Green circle: point on the wire after offsetAlongWire is applied.
          drawDebugCircle(pdf, wireBase.x, wireBase.y, [0, 210, 0], 1.8)
          if (wireOrigin) {
            // Pale green vertical segment: offsetAlongWire component.
            drawDebugLine(pdf, wireOrigin, wireBase, [120, 220, 120], 0.2)
          }
          // Green offset vector: from the wire-side base point to the label anchor.
          drawDebugLine(pdf, wireBase, anchor, [0, 210, 0], 0.25)
          drawDebugText(
            pdf,
            `d=${(o.debugDistanceFromWire ?? 0).toFixed(1)} o=${(o.debugOffsetAlongWire ?? 0).toFixed(1)}`,
            anchor.x + 1.5,
            anchor.y - 2,
            [0, 130, 0],
          )
        }

        // Red cross: desired visual centre of the wire label.
        drawDebugCross(pdf, anchor.x, anchor.y, [255, 0, 0], 1.8)
        // Orange cross: actual left-aligned insertion point passed to jsPDF.text.
        drawDebugCross(pdf, insertion.x, insertion.y, [255, 140, 0], 1.5)

        // Blue box: actual jsPDF draw model. Text is drawn left-aligned from
        // the orange insertion point, with its centre placed on the red anchor.
        drawDebugRotatedRectFromTopLeft(
          pdf,
          {
            x: insertion.x,
            y: insertion.y - textHeight / 2,
          },
          insertion,
          textWidth,
          textHeight,
          rotation,
          [0, 0, 255],
        )

        // Magenta box: canvas/Konva intent for the centered wire-label path.
        // The live canvas draws left-aligned text at local (0, 0), sets
        // offsetX=textWidth/2 and offsetY=fontSize/2, then rotates around the
        // node origin. That makes the anchor the pivot, but the unrotated text
        // box starts at anchor - (width/2, height/2).
        drawDebugRotatedRectFromTopLeft(
          pdf,
          {
            x: anchor.x - textWidth / 2,
            y: anchor.y - textHeight / 2,
          },
          anchor,
          textWidth,
          textHeight,
          o.rotationDeg ?? 0,
          [210, 0, 210],
        )

        drawDebugText(pdf, 'pdf', anchor.x + 1.5, anchor.y + 2.5, [0, 0, 255])
        drawDebugText(pdf, 'konva', anchor.x + 1.5, anchor.y + 5, [210, 0, 210])

        exportLog('[Export][WireLabel] anchor/text metrics', {
          id: o.id,
          text,
          scene: { x: o.x, y: o.y },
          pdf: anchor,
          rotation,
          fontSizePx: o.fontSize,
          fontSizePt,
          textWidth,
          textHeight,
          insertion,
          pdfRotation: rotation,
          konvaRotation: o.rotationDeg ?? 0,
          pdfDrawOptions: { align: 'left', baseline: 'middle' },
          konvaDrawModel: {
            textAlign: 'left',
            textX: 0,
            textY: 0,
            offsetX: o.estimatedWidthPx != null ? o.estimatedWidthPx / 2 : null,
            offsetY: o.fontSize / 2,
          },
          estimatedWidthPx: o.estimatedWidthPx,
          estimatedHeightPx: o.estimatedHeightPx,
          placementScale: placement.scale,
        })
      }

      pdf.setFont(fontFamily, fontStyle)
      pdf.setFontSize(fontSizePt)
      pdf.setTextColor(color)
      pdf.text(text, insertion.x, insertion.y, {
        align: 'left',
        baseline: 'middle',
        angle: rotation,
      } satisfies PdfTextOptionsWithAngle)
      continue
    }

    if (o.kind === 'secondary-bus-reference') {
      drawSecondaryBusReferenceOverlay(pdf, o, placement, fontFamily, colors.wireColor)
      continue
    }

    const { x, y } = scenePointToPdfPoint(o.x, o.y, placement)

    const fontStyle = o.fontStyle ?? 'normal'
    const color = o.color ?? colors.textColor
    const align = o.align ?? 'left'
    const baseline = getBaselineForOverlay(o.kind)

    pdf.setFont(fontFamily, fontStyle)
    pdf.setFontSize(scenePxToPdfFontSizePt(o.fontSize, placement))
    pdf.setTextColor(color)

    const baseOptions: PdfTextOptions = { align, baseline }

    if (o.rotationDeg && o.rotationDeg !== 0) {
      pdf.text(text, x, y, { ...baseOptions, angle: o.rotationDeg } satisfies PdfTextOptionsWithAngle)
    } else {
      pdf.text(text, x, y, baseOptions)
    }
  }
}

function drawSecondaryBusReferenceOverlay(
  pdf: jsPDF,
  overlay: ExportTextOverlay,
  placement: ComposedPagePlacement,
  fontFamily: string,
  fallbackColor: string
): void {
  const text = overlay.text.trim()
  if (!text) return

  const color = overlay.color ?? fallbackColor
  const fontStyle = overlay.fontStyle ?? 'normal'
  const fontSize = overlay.fontSize || SECONDARY_BUS_REFERENCE_FONT_SIZE
  const textWidth = overlay.estimatedWidthPx ?? estimateSecondaryBusReferenceTextWidth(text)
  const textCenterY = fontSize / 2
  const arrowRightX = overlay.x - textWidth - SECONDARY_BUS_REFERENCE_TEXT_GAP
  const arrowTipX = arrowRightX - SECONDARY_BUS_REFERENCE_ARROW_LENGTH

  const textAnchor = scenePointToPdfPoint(overlay.x, overlay.y, placement)
  const shaftStart = scenePointToPdfPoint(arrowRightX, overlay.y + textCenterY, placement)
  const shaftEnd = scenePointToPdfPoint(arrowTipX + 2, overlay.y + textCenterY, placement)
  const headTip = scenePointToPdfPoint(arrowTipX, overlay.y + textCenterY, placement)
  const headUpper = scenePointToPdfPoint(
    arrowTipX + SECONDARY_BUS_REFERENCE_ARROW_HEAD_LENGTH,
    overlay.y + textCenterY - SECONDARY_BUS_REFERENCE_ARROW_HEAD_HALF_HEIGHT,
    placement
  )
  const headLower = scenePointToPdfPoint(
    arrowTipX + SECONDARY_BUS_REFERENCE_ARROW_HEAD_LENGTH,
    overlay.y + textCenterY + SECONDARY_BUS_REFERENCE_ARROW_HEAD_HALF_HEIGHT,
    placement
  )

  pdf.setFont(fontFamily, fontStyle)
  pdf.setFontSize(scenePxToPdfFontSizePt(fontSize, placement))
  pdf.setTextColor(color)
  pdf.text(text, textAnchor.x, textAnchor.y, {
    align: 'right',
    baseline: 'top',
  })

  const pdfWithGraphics = pdf as PdfWithOptionalGraphicsApi
  if (typeof pdfWithGraphics.setLineCap === 'function') pdfWithGraphics.setLineCap('round')
  if (typeof pdfWithGraphics.setLineJoin === 'function') pdfWithGraphics.setLineJoin('round')
  pdf.setDrawColor(color)
  pdf.setLineWidth(scenePxToPdfMm(SECONDARY_BUS_REFERENCE_STROKE_WIDTH, placement))
  pdf.line(shaftStart.x, shaftStart.y, shaftEnd.x, shaftEnd.y)
  pdf.line(headTip.x, headTip.y, headUpper.x, headUpper.y)
  pdf.line(headTip.x, headTip.y, headLower.x, headLower.y)
}

function drawFreeNoteOverlay(
  pdf: jsPDF,
  overlay: ExportTextOverlay,
  placement: ComposedPagePlacement,
  fontFamily: string,
  fallbackColor: string,
): void {
  const baseFontSize = overlay.fontSize || 12
  const lines = noteContentToLines(overlay.text, baseFontSize)
  if (!lines.length) return

  const { x: originPdfX, y: originPdfTopY } = scenePointToPdfPoint(
    overlay.x,
    overlay.y,
    placement,
  )

  let accumulatedLineOffsetScene = 0

  for (const line of lines) {
    // Group adjacent segments that share styling so we draw longer, continuous runs.
    const mergedSegments: typeof line.segments = []
    for (const seg of line.segments) {
      if (!seg.text) continue
      const last = mergedSegments[mergedSegments.length - 1]
      if (
        last &&
        last.bold === seg.bold &&
        last.italic === seg.italic &&
        last.underline === seg.underline &&
        (last.fontSize || baseFontSize) === (seg.fontSize || baseFontSize)
      ) {
        last.text += seg.text
      } else {
        mergedSegments.push({ ...seg })
      }
    }
    if (!mergedSegments.length) {
      accumulatedLineOffsetScene += line.lineHeight
      continue
    }

    const lineTopPdfY = originPdfTopY + scenePxToPdfMm(accumulatedLineOffsetScene, placement)
    let cursorPdfX = originPdfX

    for (const segment of mergedSegments) {
      const segText = segment.text
      if (!segText) continue

      const segFontSize = segment.fontSize || baseFontSize
      const segFontSizeMm = scenePxToPdfMm(segFontSize, placement)
      let fontStyle: ExportTextOverlay['fontStyle'] = 'normal'
      if (segment.bold && segment.italic) {
        fontStyle = 'bolditalic'
      } else if (segment.bold) {
        fontStyle = 'bold'
      } else if (segment.italic) {
        fontStyle = 'italic'
      }
      const color = overlay.color ?? fallbackColor

      pdf.setFont(fontFamily, fontStyle)
      pdf.setFontSize(scenePxToPdfFontSizePt(segFontSize, placement))
      pdf.setTextColor(color)

      const widthPdf = pdf.getTextWidth(segText)

      pdf.text(segText, cursorPdfX, lineTopPdfY, {
        align: 'left',
        baseline: 'top',
      })

      if (segment.underline) {
        const lineWidth = Math.max(0.2, segFontSizeMm * 0.04)
        const underlineY = lineTopPdfY + segFontSizeMm * 0.92
        pdf.setDrawColor(color)
        pdf.setLineWidth(lineWidth)
        pdf.line(cursorPdfX, underlineY, cursorPdfX + widthPdf, underlineY)
      }

      cursorPdfX += widthPdf
    }

    accumulatedLineOffsetScene += line.lineHeight
  }
}

/**
 * Inject label elements into a slice SVG so they appear on top at the same positions
 * as on the live canvas. Only includes labels whose circuit is in sliceCircuitIds.
 */
export function injectEendraadLabelsIntoSvg(
  svgString: string,
  sliceCircuitIds: string[],
  panelLayout: BottomUpPanelLayout,
  exportTheme: ExportTheme
): string {
  const circuitIdSet = new Set(sliceCircuitIds)
  const subPanelFeedAnchors = getSubPanelIncomingFeedLabelAnchors(panelLayout)
  const subPanelFeedCircuitId = panelLayout.elements.find((e) => e.id === 'parent-mcb-label')
    ?.circuitId

  const labelElements = panelLayout.elements.filter((e) => {
    if (e.type !== 'label' || !e.label || e.id?.startsWith('circuit-notes-')) return false
    if (e.circuitId && circuitIdSet.has(e.circuitId)) return true
    if (
      subPanelFeedAnchors &&
      e.id?.startsWith('parent-tag-') &&
      subPanelFeedCircuitId &&
      circuitIdSet.has(subPanelFeedCircuitId)
    ) {
      return true
    }
    return false
  })
  const circuitNotes = (panelLayout.circuitNotes ?? []).filter(
    (n) => circuitIdSet.has(n.circuitId) && (n.label ?? '').trim() && n.notesVisible !== false
  )
  if (labelElements.length === 0 && circuitNotes.length === 0) return svgString

  const parser = new DOMParser()
  const doc = parser.parseFromString(svgString, 'image/svg+xml')
  const parserError = doc.querySelector('parsererror')
  if (parserError) return svgString

  const svgRoot = doc.documentElement
  const ns = 'http://www.w3.org/2000/svg'
  const labelGroup = doc.createElementNS(ns, 'g')
  labelGroup.setAttribute('data-export', 'eendraad-labels')

  const colors = getThemeColors(exportTheme)
  const fontFamily = getExportFontFamily()
  const fill = colors.textColor
  const notesFill = colors.secondaryText ?? colors.textColor

  for (const el of labelElements) {
    let x = el.position.x
    let y = el.position.y - LABEL_Y_OFFSET
    if (subPanelFeedAnchors && el.id === 'parent-mcb-label') {
      x = subPanelFeedAnchors.centerX
      y = subPanelFeedAnchors.circuitAnchorY - LABEL_Y_OFFSET
    } else if (subPanelFeedAnchors && el.id?.startsWith('parent-tag-')) {
      x = subPanelFeedAnchors.centerX
      y = subPanelFeedAnchors.circuitAnchorY - LABEL_Y_OFFSET
    }

    const text = (el.label ?? '').trim()
    if (!text) continue

    const isBranchLabel = !!el.branchId
    const circuitLabel = labelElements.find(
      (candidate) => candidate.circuitId === el.circuitId && !candidate.branchId
    )
    if (isBranchLabel && circuitLabel?.label) {
      x = getCenteredCircuitLabelRight(circuitLabel.position.x, circuitLabel.label)
    }
    const alignIsRight = isBranchLabel
    const fontSizePx =
      subPanelFeedAnchors && el.id?.startsWith('parent-tag-')
        ? SUBPANEL_PARENT_TAG_FONT_SIZE
        : LABEL_FONT_SIZE
    const textEl = doc.createElementNS(ns, 'text')
    textEl.setAttribute('x', String(x))
    textEl.setAttribute('y', String(y))
    textEl.setAttribute('font-size', String(fontSizePx))
    textEl.setAttribute('font-family', fontFamily)
    textEl.setAttribute('fill', fill)
    const textAnchor: 'start' | 'middle' | 'end' = alignIsRight
        ? 'end'
        : 'middle'
    textEl.setAttribute('text-anchor', textAnchor)
    textEl.setAttribute('dominant-baseline', 'hanging')
    textEl.textContent = text
    labelGroup.appendChild(textEl)
  }

  // Circuit notes labels (drawn after regular labels; same positions as live canvas)
  for (const note of circuitNotes) {
    const text = normalizeCircuitNotesText(note.label)
    if (!text) continue

    const orientation = note.notesOrientation ?? 'horizontal'
    const placements = getCircuitNoteLinePlacements({
      text,
      x: note.x,
      y: note.y,
      orientation,
      fontFamily,
    })

    for (const placement of placements) {
      const textEl = doc.createElementNS(ns, 'text')
      textEl.setAttribute('x', String(placement.x))
      textEl.setAttribute('y', String(placement.y))
      textEl.setAttribute('font-size', String(NOTES_FONT_SIZE))
      textEl.setAttribute('font-family', fontFamily)
      textEl.setAttribute('fill', notesFill)
      textEl.setAttribute('font-style', 'italic')
      textEl.setAttribute('text-anchor', 'start')
      textEl.setAttribute('dominant-baseline', 'middle')
      if (placement.rotationDeg !== 0) {
        textEl.setAttribute(
          'transform',
          `rotate(${placement.rotationDeg} ${placement.x} ${placement.y})`
        )
      }
      textEl.textContent = placement.text
      labelGroup.appendChild(textEl)
    }
  }

  svgRoot.appendChild(labelGroup)
  return new XMLSerializer().serializeToString(doc)
}
