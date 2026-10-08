/* eslint-disable react-refresh/only-export-components */
import { memo, useMemo } from 'react'
import { Group, Line, Rect, Text } from 'react-konva'
import { useTranslation } from 'react-i18next'
import type { TFunction } from 'i18next'
import type { KonvaEventObject } from 'konva/lib/Node'
import {
  LAYOUT_CONSTANTS,
  getPanelDiagramId,
  type BottomUpLayoutResult,
  type BottomUpPanelLayout,
} from '@/lib/layout/bottomUpLayout'
import type {
  Circuit,
  Endpoint,
  Panel,
  ProtectionDevice,
  TrunkDevice,
  WireSegment,
} from '@/types/schema'
import { EENDRAAD_PANEL_SYMBOL_WIDTH } from './canvasSymbols'
import {
  CIRCUIT_NOTES_PAINT_PADDING,
  getCircuitNotesPaintBounds,
} from '@/lib/layout/circuitNoteMetrics'
import {
  WIRE_LABEL_DISTANCE_FROM_WIRE,
  WIRE_LABEL_FONT_SIZE,
  WIRE_LABEL_LINE_GAP,
  formatWireLabel,
  getSupplyWireLabelAnchor,
  isHorizontalSupplyTrunkSegment,
} from '@/lib/wireTextLabel'
import {
  isFireClassLabelVisibleForSegment,
  isWireLabelVisibleForSegment,
  isWireLengthLabelVisibleForSegment,
} from '@/lib/wireLabelVisibility'
import {
  formatInstallYearLabel,
  getEffectiveInstallYear,
  getExplicitInstallYear,
  getInstallYearFrameYear,
  installYearColor,
  isInstallationDateSuppressed,
  isOldInstallYear,
  type ProjectWithOptionalInstallYear,
} from '@/lib/installDates'
import type { ResolvedFrameItem } from '@/lib/eendraad/frameContent'
import {
  collectDomoticaRowLabelRects,
  collectEendraadDeviceLabelRects,
  computeEendraadFrameBounds,
  type EendraadFrameBounds,
} from '@/lib/eendraad/frameBounds'
import {
  buildInstallDateInheritanceIndex,
  installDateTargetKey,
  type InstallDateInheritance,
  type InstallDateInheritanceIndex,
  type InstallDateTarget,
} from '@/lib/installDatePropagation'
import {
  buildCircuitGraphIndex,
  collectPanelTreeSubCircuitIds,
  resolveCircuitReference,
  type CircuitGraphIndex,
} from '@/lib/eendraad/circuitGraph'
import {
  resolvePanelSupplyLinkForPanel,
  resolvePanelSupplyLinksForSourcePanel,
} from '@/lib/eendraad/panelSupplyLink'
import {
  getProjectElectricalPanels,
  type ProjectWithOptionalV2Electrical,
} from '@/lib/projectV2/electrical'

type DateEntity = Panel | ProtectionDevice | Circuit | Endpoint | TrunkDevice
export type InstallDateOverlayProject = ProjectWithOptionalV2Electrical &
  ProjectWithOptionalInstallYear & {
    project: {
      installDateColors?: Record<string, string>
    }
  }

interface InstallDateOverlayProps {
  project: InstallDateOverlayProject
  layout: BottomUpLayoutResult | null
  wireSegments?: readonly WireSegment[]
  visible: boolean
  monochrome: boolean
  selectionEnabled: boolean
  onSelectFrame?: (frame: {
    targets: InstallDateTarget[]
    year: number
    bounds: EendraadFrameBounds
  }) => void
}

export function isInstallDateOverlayInteractive(
  selectionEnabled: boolean,
  onSelectFrame: InstallDateOverlayProps['onSelectFrame']
): boolean {
  return selectionEnabled && typeof onSelectFrame === 'function'
}

export function isPrimaryInstallDateFrameClick(button?: number): boolean {
  return button == null || button === 0
}

export interface DateFrame {
  id: string
  year: number
  label: string
  color: string
  itemCount: number
  x: number
  y: number
  width: number
  height: number
  labelX?: number
  labelY?: number
  labelWidth?: number
  relationBounds?: EendraadFrameBounds
  labelPlacement?: 'supplyProtection' | 'panel'
  borderless?: boolean
  targets: InstallDateTarget[]
}

interface DateCandidate {
  year: number
  item: ResolvedFrameItem
  bounds: EendraadFrameBounds
  relationBounds: EendraadFrameBounds
  forceSingle?: boolean
  targets?: InstallDateTarget[]
  labelPlacement?: 'supplyProtection'
  expandedFromParent?: boolean
}

interface DateBlocker {
  year: number
  item: ResolvedFrameItem
  bounds: EendraadFrameBounds
  // Explicitly unmarked items never belong to any date frame.
  unmarked?: boolean
}

interface RectBounds {
  x: number
  y: number
  width: number
  height: number
}

function isEndpointEntity(entity: DateEntity): entity is Endpoint {
  return 'symbol' in entity
}

function containsBounds(outer: EendraadFrameBounds, inner: EendraadFrameBounds): boolean {
  const tolerance = 1
  return (
    inner.x >= outer.x - tolerance &&
    inner.y >= outer.y - tolerance &&
    inner.x + inner.width <= outer.x + outer.width + tolerance &&
    inner.y + inner.height <= outer.y + outer.height + tolerance
  )
}

/** A year this close to its item reads as its caption; farther away it needs a leader line. */
const RELATION_LINE_FREE_GAP = 4

function rectGap(a: RectBounds, b: RectBounds): number {
  const dx = Math.max(0, a.x - (b.x + b.width), b.x - (a.x + a.width))
  const dy = Math.max(0, a.y - (b.y + b.height), b.y - (a.y + a.height))
  return Math.hypot(dx, dy)
}

function rectsOverlap(a: RectBounds, b: RectBounds): boolean {
  return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y
}

function estimateOverlayTextWidth(text: string, fontSize: number): number {
  return Math.max(24, text.length * fontSize * 0.62)
}

function estimateRelationTextWidth(text: string, fontSize: number): number {
  return Math.max(18, text.length * fontSize * 0.52)
}

function lineRectBoundaryT(
  from: { x: number; y: number },
  to: { x: number; y: number },
  rect: RectBounds
): number | null {
  const dx = to.x - from.x
  const dy = to.y - from.y
  const hits: number[] = []
  if (Math.abs(dx) > 0.001) {
    hits.push((rect.x - from.x) / dx)
    hits.push((rect.x + rect.width - from.x) / dx)
  }
  if (Math.abs(dy) > 0.001) {
    hits.push((rect.y - from.y) / dy)
    hits.push((rect.y + rect.height - from.y) / dy)
  }
  const valid = hits
    .filter((t) => t >= 0 && t <= 1)
    .filter((t) => {
      const x = from.x + dx * t
      const y = from.y + dy * t
      return (
        x >= rect.x - 0.5 &&
        x <= rect.x + rect.width + 0.5 &&
        y >= rect.y - 0.5 &&
        y <= rect.y + rect.height + 0.5
      )
    })
  if (valid.length === 0) return null
  return Math.min(...valid)
}

function clippedRelationLine(
  labelRect: RectBounds,
  symbolRect: RectBounds
): [number, number, number, number] | null {
  const labelCenter = {
    x: labelRect.x + labelRect.width / 2,
    y: labelRect.y + labelRect.height / 2,
  }
  const symbolCenter = {
    x: symbolRect.x + symbolRect.width / 2,
    y: symbolRect.y + symbolRect.height / 2,
  }
  const labelExit = lineRectBoundaryT(labelCenter, symbolCenter, labelRect)
  const symbolEnter = lineRectBoundaryT(symbolCenter, labelCenter, symbolRect)
  if (labelExit == null || symbolEnter == null) return null
  const centerDistance = Math.hypot(symbolCenter.x - labelCenter.x, symbolCenter.y - labelCenter.y)
  if (centerDistance < 1) return null
  const marginT = Math.min(0.03, 0.5 / centerDistance)
  const startT = labelExit + marginT
  const endT = 1 - symbolEnter - marginT
  if (endT <= startT) return null
  const dx = symbolCenter.x - labelCenter.x
  const dy = symbolCenter.y - labelCenter.y
  return [
    labelCenter.x + dx * startT,
    labelCenter.y + dy * startT,
    labelCenter.x + dx * endT,
    labelCenter.y + dy * endT,
  ]
}

/** Painted text of circuit notes; vertical notes rise from their anchor, they don't centre on it. */
function buildCircuitNoteObstacles(panelLayout: BottomUpPanelLayout): RectBounds[] {
  return (panelLayout.circuitNotes ?? [])
    .filter((note) => note.notesVisible && note.label.trim())
    .map((note) => {
      const paint = getCircuitNotesPaintBounds(note.label, note.notesOrientation)
      const pad = CIRCUIT_NOTES_PAINT_PADDING - 2
      return {
        x: note.x + paint.left + pad,
        y: note.y + paint.top + pad,
        width: paint.right - paint.left - pad * 2,
        height: paint.bottom - paint.top - pad * 2,
      }
    })
}

function buildLabelObstacles(panelLayout: BottomUpPanelLayout): RectBounds[] {
  return panelLayout.elements
    .filter(
      (element) =>
        element.type === 'label' &&
        element.label?.trim() &&
        !element.id.startsWith('circuit-notes-')
    )
    .map((element) => {
      const text = element.label ?? ''
      const width = Math.max(22, estimateOverlayTextWidth(text, 11))
      const vertical = element.height != null && element.height > (element.width ?? 0)
      if (vertical) {
        return {
          x: element.position.x - 8,
          y: element.position.y - Math.max(width, element.height ?? 0) / 2,
          width: 16,
          height: Math.max(width, element.height ?? 0),
        }
      }
      // Branch and circuit letters are right-aligned on their layout X (see layoutTree).
      const rightAligned = !!element.branchId || !!element.circuitId
      const pad = 3
      return {
        x: (rightAligned ? element.position.x - width : element.position.x - width / 2) - pad,
        y: element.position.y - 8,
        width: width + pad * 2,
        height: 17,
      }
    })
}

const SYMBOL_OBSTACLE_TYPES = new Set(['endpoint', 'protection', 'rcd', 'trunkDevice'])

function buildSymbolObstacles(panelLayout: BottomUpPanelLayout): RectBounds[] {
  const half = LAYOUT_CONSTANTS.SYMBOL_SIZE / 2
  const symbolAt = ({ x, y }: { x: number; y: number }) => ({
    x: x - half,
    y: y - half,
    width: half * 2,
    height: half * 2,
  })
  return [
    ...panelLayout.elements
      .filter((element) => SYMBOL_OBSTACLE_TYPES.has(element.type))
      .map((element) => symbolAt(element.position)),
    ...(panelLayout.supplyDevices ?? []).map(symbolAt),
    ...(panelLayout.groundDevices ?? []).map(symbolAt),
  ]
}

const WIRE_OBSTACLE_HALF_WIDTH = 2

/** Wires of this diagram and their cable captions; a year must never sit on either. */
function buildWireObstacles(
  panelLayout: BottomUpPanelLayout,
  wireSegments: readonly WireSegment[]
): RectBounds[] {
  const diagramId = getPanelDiagramId(panelLayout)
  const lineStep = WIRE_LABEL_FONT_SIZE + WIRE_LABEL_LINE_GAP
  const obstacles: RectBounds[] = []
  for (const segment of wireSegments) {
    if (segment.panelId !== panelLayout.panel.id) continue
    if ((segment.diagramId ?? segment.panelId) !== diagramId) continue
    const { startPoint: start, endPoint: end } = segment
    const vertical = start.x === end.x
    if (!vertical && start.y !== end.y) continue
    obstacles.push({
      x: Math.min(start.x, end.x) - WIRE_OBSTACLE_HALF_WIDTH,
      y: Math.min(start.y, end.y) - WIRE_OBSTACLE_HALF_WIDTH,
      width: Math.abs(end.x - start.x) + WIRE_OBSTACLE_HALF_WIDTH * 2,
      height: Math.abs(end.y - start.y) + WIRE_OBSTACLE_HALF_WIDTH * 2,
    })
    if (!isWireLabelVisibleForSegment(segment)) continue

    const extraLines =
      (isFireClassLabelVisibleForSegment(segment) ? 1 : 0) +
      (isWireLengthLabelVisibleForSegment(segment) ? 1 : 0)
    const stackDepth = WIRE_LABEL_FONT_SIZE + extraLines * lineStep
    if (isHorizontalSupplyTrunkSegment(segment)) {
      const anchor = getSupplyWireLabelAnchor(segment) ?? start
      const width = estimateRelationTextWidth(formatWireLabel(segment), WIRE_LABEL_FONT_SIZE)
      obstacles.push({
        x: anchor.x - width / 2,
        y: anchor.y - WIRE_LABEL_DISTANCE_FROM_WIRE - stackDepth,
        width,
        height: stackDepth + WIRE_LABEL_DISTANCE_FROM_WIRE,
      })
    } else if (vertical) {
      // Vertical captions are truncated to their run, so the run bounds their length.
      const labelEnd = segment.wireLabelBaseEndPoint ?? segment.wireLabelEndPoint ?? end
      obstacles.push({
        x: start.x,
        y: Math.min(start.y, labelEnd.y),
        width: WIRE_LABEL_DISTANCE_FROM_WIRE + stackDepth + 4,
        height: Math.abs(labelEnd.y - start.y),
      })
    }
  }
  return obstacles
}

/** Names drawn beside linked panel symbols, e.g. "Bord 2". */
function buildPanelSymbolNameObstacles(panelLayout: BottomUpPanelLayout): RectBounds[] {
  const fontSize = 12
  return panelLayout.elements
    .filter((element) => element.type === 'endpoint' && element.id?.startsWith('subpanel-symbol-'))
    .map((element) => {
      const endpoint = element.endpointId
        ? findEndpointInPanel(panelLayout.panel, element.endpointId)
        : undefined
      const nameWidth = estimateOverlayTextWidth(endpoint?.label?.trim() || 'Bord 0', fontSize)
      const left = element.position.x - EENDRAAD_PANEL_SYMBOL_WIDTH / 2
      return {
        x: left,
        y: element.position.y - fontSize,
        width: EENDRAAD_PANEL_SYMBOL_WIDTH + 5 + nameWidth,
        height: fontSize * 2,
      }
    })
}

/** Spots touching the dated item itself, so the year reads as its caption without a leader line. */
function huggingCandidates(
  content: RectBounds,
  textWidth: number,
  textHeight: number
): Array<{ x: number; y: number }> {
  const gap = RELATION_LINE_FREE_GAP - 1
  const right = content.x + content.width
  const bottom = content.y + content.height
  const middleY = content.y + (content.height - textHeight) / 2
  return [
    { x: right - textWidth, y: content.y - textHeight - gap },
    { x: right + gap, y: content.y - textHeight / 2 },
    { x: right + gap, y: middleY },
    { x: right + gap, y: bottom - textHeight / 2 },
    { x: right - textWidth, y: bottom + gap },
    { x: content.x, y: content.y - textHeight - gap },
    { x: content.x - textWidth - gap, y: middleY },
    { x: content.x, y: bottom + gap },
  ]
}

function overlapArea(a: RectBounds, b: RectBounds): number {
  const width = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x)
  const height = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y)
  return width > 0 && height > 0 ? width * height : 0
}

function shrinkFramePaddingCollisions(frames: DateFrame[]): DateFrame[] {
  const adjusted = frames.map((frame) => ({ ...frame }))
  const fitPaddingBetween = (before: DateFrame, after: DateFrame, axis: 'x' | 'y'): boolean => {
    const beforeContent = before.relationBounds!
    const afterContent = after.relationBounds!
    const size = axis === 'x' ? 'width' : 'height'
    const beforeContentEnd = beforeContent[axis] + beforeContent[size]
    const afterContentStart = afterContent[axis]
    const gap = Math.max(0, afterContentStart - beforeContentEnd)
    const beforeEnd = before[axis] + before[size]
    const beforePadding = Math.max(0, beforeEnd - beforeContentEnd)
    const afterPadding = Math.max(0, afterContentStart - after[axis])
    const paddingTotal = beforePadding + afterPadding
    if (paddingTotal <= gap || paddingTotal === 0) return false

    const nextBeforePadding = gap * (beforePadding / paddingTotal)
    const nextAfterPadding = gap - nextBeforePadding
    before[size] = beforeContentEnd + nextBeforePadding - before[axis]
    const afterEnd = after[axis] + after[size]
    after[axis] = afterContentStart - nextAfterPadding
    after[size] = afterEnd - after[axis]
    return true
  }

  // A few passes settle rows where one frame touches neighbours on both sides.
  for (let pass = 0; pass < Math.min(adjusted.length, 4); pass += 1) {
    let changed = false
    for (let index = 0; index < adjusted.length; index += 1) {
      const a = adjusted[index]!
      if (!a.relationBounds) continue
      for (let otherIndex = index + 1; otherIndex < adjusted.length; otherIndex += 1) {
        const b = adjusted[otherIndex]!
        if (!b.relationBounds || !rectsOverlap(a, b)) continue
        if (
          containsBounds(a.relationBounds, b.relationBounds) ||
          containsBounds(b.relationBounds, a.relationBounds)
        ) {
          continue
        }

        const aBottom = a.relationBounds.y + a.relationBounds.height
        const bBottom = b.relationBounds.y + b.relationBounds.height
        if (aBottom <= b.relationBounds.y) {
          changed = fitPaddingBetween(a, b, 'y') || changed
        } else if (bBottom <= a.relationBounds.y) {
          changed = fitPaddingBetween(b, a, 'y') || changed
        } else {
          const aRight = a.relationBounds.x + a.relationBounds.width
          const bRight = b.relationBounds.x + b.relationBounds.width
          if (aRight <= b.relationBounds.x) {
            changed = fitPaddingBetween(a, b, 'x') || changed
          } else if (bRight <= a.relationBounds.x) {
            changed = fitPaddingBetween(b, a, 'x') || changed
          }
        }
      }
    }
    if (!changed) break
  }

  return adjusted
}

function placeFrameLabels(
  frames: DateFrame[],
  panelLayout: BottomUpPanelLayout,
  wireSegments: readonly WireSegment[]
): DateFrame[] {
  const obstacles = [
    ...buildLabelObstacles(panelLayout),
    ...buildCircuitNoteObstacles(panelLayout),
    ...buildWireObstacles(panelLayout, wireSegments),
    ...collectEendraadDeviceLabelRects(panelLayout),
    ...collectDomoticaRowLabelRects(panelLayout),
    ...buildPanelSymbolNameObstacles(panelLayout),
  ]
  const symbolObstacles = buildSymbolObstacles(panelLayout)
  const placedLabels: RectBounds[] = []
  const fontSize = 11
  return frames.map((frame) => {
    const isSingle = frame.itemCount <= 1
    const isOldInstallFrame = isOldInstallYear(frame.year)
    const textWidth = estimateOverlayTextWidth(frame.label, fontSize)
    const textHeight = fontSize + 2
    const gap = isSingle ? 3 : 14
    const singleAnchor = frame
    const preferredCandidates: Array<{ x: number; y: number }> =
      frame.labelPlacement === 'panel'
        ? [
            {
              x: frame.x + frame.width - textWidth,
              y: frame.y - textHeight - 2,
            },
          ]
        : frame.labelPlacement === 'supplyProtection'
        ? [
            { x: frame.x + frame.width / 2 - textWidth / 2, y: frame.y + frame.height + 2 },
            {
              x: frame.x + frame.width / 2 - textWidth / 2,
              y: frame.y + frame.height - textHeight - 2,
            },
            { x: frame.x + frame.width - textWidth, y: frame.y - gap },
          ]
        : isSingle
          ? [
              {
                x: singleAnchor.x + singleAnchor.width - 20,
                y: singleAnchor.y + singleAnchor.height * 0.18,
              },
              {
                x: singleAnchor.x + singleAnchor.width - 20,
                y: singleAnchor.y + singleAnchor.height * 0.34,
              },
              { x: singleAnchor.x + singleAnchor.width - textWidth + 10, y: singleAnchor.y + 4 },
              {
                x: singleAnchor.x + singleAnchor.width - textWidth + 10,
                y: singleAnchor.y + singleAnchor.height - textHeight - 2,
              },
              { x: singleAnchor.x - textWidth - 4, y: singleAnchor.y + singleAnchor.height * 0.2 },
              { x: singleAnchor.x + singleAnchor.width - textWidth, y: singleAnchor.y - gap },
            ]
          : isOldInstallFrame
            ? [
                { x: frame.x + frame.width - textWidth, y: frame.y - 14 },
                { x: frame.x + frame.width - textWidth, y: frame.y + 4 },
                { x: frame.x + frame.width - textWidth, y: frame.y + frame.height + 4 },
                { x: frame.x, y: frame.y - 14 },
                { x: frame.x - textWidth - 4, y: frame.y },
              ]
            : [
                { x: frame.x + frame.width - textWidth, y: frame.y - gap },
                { x: frame.x + frame.width + 3, y: frame.y + (frame.height - textHeight) / 2 },
                { x: frame.x + frame.width - textWidth, y: frame.y + frame.height + 2 },
                { x: frame.x + frame.width - textWidth, y: frame.y + 2 },
                { x: frame.x, y: frame.y - gap },
                { x: frame.x - textWidth - 3, y: frame.y + (frame.height - textHeight) / 2 },
              ]
    const fallbackCandidates = [
      { x: frame.x + frame.width + 4, y: frame.y - textHeight - 2 },
      { x: frame.x - textWidth - 4, y: frame.y - textHeight - 2 },
      { x: frame.x + frame.width + 4, y: frame.y + frame.height + 2 },
      { x: frame.x - textWidth - 4, y: frame.y + frame.height + 2 },
    ]
    // Crowded spots: walk further out before accepting any overlap.
    const outwardCandidates = [1, 2, 3].flatMap((step) => {
      const dx = step * (textWidth / 2 + 6)
      const dy = step * (textHeight + 4)
      return [
        { x: frame.x + frame.width - textWidth + dx, y: frame.y - textHeight - 2 - dy },
        { x: frame.x - dx, y: frame.y - textHeight - 2 - dy },
        { x: frame.x + frame.width + 4 + dx, y: frame.y + (frame.height - textHeight) / 2 },
        { x: frame.x - textWidth - 4 - dx, y: frame.y + (frame.height - textHeight) / 2 },
        { x: frame.x + frame.width - textWidth + dx, y: frame.y + frame.height + 2 + dy },
        { x: frame.x - dx, y: frame.y + frame.height + 2 + dy },
      ]
    })
    const candidates = [
      ...preferredCandidates,
      ...huggingCandidates(frame.relationBounds ?? frame, textWidth, textHeight),
      ...fallbackCandidates,
      ...outwardCandidates,
    ]
    const frameContent = frame.relationBounds ?? frame
    const neighbouringFrames = frames.filter((other) => {
      if (other.id === frame.id || !other.relationBounds) return false
      return !(
        containsBounds(frameContent, other.relationBounds) ||
        containsBounds(other.relationBounds, frameContent)
      )
    })
    // The frame's own symbols are expected under or beside its label; any other
    // symbol under the label makes it read as marking the wrong item.
    const foreignSymbols = symbolObstacles.filter(
      (symbol) => !rectsOverlap(symbol, frameContent)
    )
    const oldSingleLeftShift =
      isSingle && isOldInstallFrame ? estimateOverlayTextWidth('2026', fontSize) : 0
    const labelRectFor = (candidate: { x: number; y: number }) => ({
      x: candidate.x - oldSingleLeftShift - 2,
      y: candidate.y - 2,
      width: textWidth + 4,
      height: textHeight + 4,
    })
    const blocking = [...obstacles, ...placedLabels, ...neighbouringFrames, ...foreignSymbols]
    const chosen =
      candidates.find(
        (candidate) =>
          !blocking.some((obstacle) => rectsOverlap(labelRectFor(candidate), obstacle))
      ) ??
      // Nothing is free: take the spot that covers the least, not blindly the first.
      candidates.reduce(
        (best, candidate) => {
          const rect = labelRectFor(candidate)
          const cost = blocking.reduce((sum, obstacle) => sum + overlapArea(rect, obstacle), 0)
          return cost < best.cost ? { candidate, cost } : best
        },
        { candidate: candidates[0]!, cost: Number.POSITIVE_INFINITY }
      ).candidate
    const labelX = chosen.x - oldSingleLeftShift
    const labelRect = {
      x: labelX - 2,
      y: chosen.y - 2,
      width: textWidth + 4,
      height: textHeight + 4,
    }
    placedLabels.push(labelRect)
    return {
      ...frame,
      labelX,
      labelY: chosen.y,
      labelWidth: textWidth,
    }
  })
}

function walkPanelDateEntities(
  graph: CircuitGraphIndex,
  inheritance: InstallDateInheritanceIndex,
  panel: Panel,
  panelInheritedYear: number,
  visit: (
    entity: DateEntity,
    kind: ResolvedFrameItem['kind'] | 'panel',
    inheritedYear: number | undefined,
    inheritedSource: InstallDateTarget | undefined
  ) => void
) {
  // Inherited years come from the shared resolver so the overlay and date editing
  // always agree; the walk only decides which entities belong to this panel layout.
  const inherited = (
    target: Pick<InstallDateTarget, 'id' | 'type'>,
    fallback: InstallDateInheritance
  ): InstallDateInheritance => inheritance.get(installDateTargetKey(target)) ?? fallback
  const ownDate = (
    entity: DateEntity,
    target: Pick<InstallDateTarget, 'id' | 'type'>,
    inheritedDate: InstallDateInheritance
  ): InstallDateInheritance =>
    getExplicitInstallYear(entity) != null
      ? { year: getEffectiveInstallYear(null, entity, inheritedDate.year), source: target }
      : inheritedDate
  const panelTreeSubCircuitIds = collectPanelTreeSubCircuitIds(panel)
  const visitCircuit = (
    circuit: Circuit,
    parentDate: InstallDateInheritance,
    visited = new Set<string>()
  ) => {
    if (visited.has(circuit.id)) return
    visited.add(circuit.id)
    const circuitTarget = { id: circuit.id, type: 'circuit' as const }
    const circuitInherited = inherited(circuitTarget, parentDate)
    visit(circuit, 'endpoint', circuitInherited.year, circuitInherited.source)
    const circuitDate = ownDate(circuit, circuitTarget, circuitInherited)
    for (const trunkDevice of circuit.trunkDevices ?? []) {
      const trunkInherited = inherited({ id: trunkDevice.id, type: 'trunkDevice' }, circuitDate)
      visit(trunkDevice, 'trunkDevice', trunkInherited.year, trunkInherited.source)
    }
    for (const endpoint of circuit.endpoints) {
      const endpointInherited = inherited({ id: endpoint.id, type: 'endpoint' }, circuitDate)
      visit(endpoint, 'endpoint', endpointInherited.year, endpointInherited.source)
    }
    for (const subCircuitId of circuit.subCircuitIds ?? []) {
      const referenceTarget = resolveCircuitReference(graph, subCircuitId)
      if (
        referenceTarget.kind === 'circuit' &&
        graph.canonicalOwnerByCircuitId.get(referenceTarget.circuit.id)?.panel.id === panel.id
      ) {
        visitCircuit(referenceTarget.circuit, circuitDate, visited)
      }
    }
  }

  const panelTarget = { id: panel.id, type: 'panel' as const }
  visit(panel, 'panel', panelInheritedYear, undefined)
  // A panel's own frame is its borderless label; children only cite the panel
  // as their date source when the panel itself is explicitly dated.
  const panelDate = ownDate(panel, panelTarget, { year: panelInheritedYear, source: undefined })

  for (const protection of panel.protections) {
    const protectionTarget = { id: protection.id, type: 'protection' as const }
    const protectionInherited = inherited(protectionTarget, panelDate)
    visit(protection, 'protection', protectionInherited.year, protectionInherited.source)
    const protectionDate = ownDate(protection, protectionTarget, protectionInherited)
    for (const circuit of protection.circuits ?? []) {
      if (panelTreeSubCircuitIds.has(circuit.id) && !graph.protectedCircuitIds.has(circuit.id))
        continue
      visitCircuit(circuit, protectionDate)
    }
  }

  for (const circuit of panel.circuits) {
    if (panelTreeSubCircuitIds.has(circuit.id)) continue
    visitCircuit(circuit, panelDate)
  }
}

function findEndpointInPanel(panel: Panel, endpointId: string): Endpoint | undefined {
  const scanCircuit = (circuit: Circuit) =>
    circuit.endpoints.find((endpoint) => endpoint.id === endpointId)
  for (const circuit of panel.circuits) {
    const found = scanCircuit(circuit)
    if (found) return found
  }
  for (const protection of panel.protections) {
    for (const circuit of protection.circuits ?? []) {
      const found = scanCircuit(circuit)
      if (found) return found
    }
  }
  for (const subPanel of panel.subPanels) {
    const found = findEndpointInPanel(subPanel, endpointId)
    if (found) return found
  }
  return undefined
}

function findPanelInProject(
  project: InstallDateOverlayProject,
  panelId: string
): Panel | undefined {
  const visit = (panels: Panel[]): Panel | undefined => {
    for (const panel of panels) {
      if (panel.id === panelId) return panel
      const found = visit(panel.subPanels)
      if (found) return found
    }
    return undefined
  }
  return visit(getProjectElectricalPanels(project))
}

function findPanelByNameInProject(
  project: InstallDateOverlayProject,
  name: string
): Panel | undefined {
  const visit = (panels: Panel[]): Panel | undefined => {
    for (const panel of panels) {
      if (panel.name === name || Object.values(panel.nameByLocale ?? {}).includes(name))
        return panel
      const found = visit(panel.subPanels)
      if (found) return found
    }
    return undefined
  }
  return visit(getProjectElectricalPanels(project))
}

export function buildDateFramesForPanel(
  project: InstallDateOverlayProject,
  panelLayout: BottomUpPanelLayout,
  monochrome: boolean,
  t: TFunction,
  inheritance: InstallDateInheritanceIndex = buildInstallDateInheritanceIndex(project),
  wireSegments: readonly WireSegment[] = []
): DateFrame[] {
  const graph = buildCircuitGraphIndex(project)
  const candidates: DateCandidate[] = []
  const blockers: DateBlocker[] = []
  const directPanelYears: number[] = []
  const getEndpoint = (id: string) => findEndpointInPanel(panelLayout.panel, id)
  const getCanonicalFrameItem = (item: ResolvedFrameItem): ResolvedFrameItem => {
    if (item.kind !== 'endpoint') return item

    // A linked panel endpoint is retained in the circuit graph for topology,
    // while layout adds a dedicated subpanel-symbol element for the same
    // painted symbol. Date candidates must use that one visual identity or
    // the endpoint and panel-symbol passes create two identical year labels.
    const panelSymbol = panelLayout.elements.find(
      (element) =>
        element.type === 'endpoint' &&
        element.id?.startsWith('subpanel-symbol-') &&
        element.endpointId === item.id
    )
    return panelSymbol ? { id: panelSymbol.id, kind: 'panelSymbol' } : item
  }
  const panelInheritedYear =
    inheritance.get(installDateTargetKey({ id: panelLayout.panel.id, type: 'panel' }))?.year ??
    getEffectiveInstallYear(project, null)
  const panelYear = getEffectiveInstallYear(project, panelLayout.panel, panelInheritedYear)
  const pushItem = (
    year: number,
    item: ResolvedFrameItem,
    options?: {
      forceSingle?: boolean
      targets?: InstallDateTarget[]
      labelPlacement?: 'supplyProtection'
      expandedFromParent?: boolean
    }
  ) => {
    const canonicalItem = getCanonicalFrameItem(item)
    const frameYear = getInstallYearFrameYear(year)
    const existingCandidate = candidates.find(
      (candidate) =>
        candidate.item.id === canonicalItem.id &&
        candidate.item.kind === canonicalItem.kind &&
        getInstallYearFrameYear(candidate.year) === frameYear
    )
    if (existingCandidate) {
      if (options?.targets) existingCandidate.targets = options.targets
      if (options?.forceSingle) existingCandidate.forceSingle = true
      if (options?.labelPlacement) existingCandidate.labelPlacement = options.labelPlacement
      if (existingCandidate.expandedFromParent && !options?.expandedFromParent) {
        existingCandidate.expandedFromParent = false
      }
      return
    }
    const bounds = computeEendraadFrameBounds({
      items: [canonicalItem],
      panelLayout,
      getEndpointById: getEndpoint,
      includeEndpointLabels: false,
    })
    const relationBounds = computeEendraadFrameBounds({
      items: [canonicalItem],
      panelLayout,
      getEndpointById: getEndpoint,
      padding: 0,
      includeEndpointLabels: false,
    })
    if (!bounds || !relationBounds) return
    candidates.push({
      year,
      item: canonicalItem,
      bounds,
      relationBounds,
      forceSingle: options?.forceSingle,
      targets: options?.targets,
      labelPlacement: options?.labelPlacement,
      expandedFromParent: options?.expandedFromParent,
    })
  }
  const pushBlocker = (year: number, item: ResolvedFrameItem, unmarked = false) => {
    const existing = blockers.find(
      (blocker) => blocker.item.id === item.id && blocker.item.kind === item.kind
    )
    if (existing) {
      if (unmarked) existing.unmarked = true
      return
    }
    const bounds = computeEendraadFrameBounds({
      items: [item],
      panelLayout,
      getEndpointById: getEndpoint,
      padding: 0,
      includeEndpointLabels: false,
    })
    if (!bounds) return
    blockers.push({ year, item, bounds, unmarked })
  }

  walkPanelDateEntities(
    graph,
    inheritance,
    panelLayout.panel,
    panelInheritedYear,
    (entity, kind, inheritedYear, inheritedSource) => {
      if (isInstallationDateSuppressed(entity)) {
        // Unmarked items must still block neighbouring frames, otherwise a
        // same-year group grows over them and they look marked again.
        if (kind === 'protection' || kind === 'trunkDevice') {
          pushBlocker(inheritedYear ?? panelYear, { id: entity.id, kind }, true)
        } else if (kind === 'endpoint' && !('endpoints' in entity)) {
          pushBlocker(inheritedYear ?? panelYear, { id: entity.id, kind: 'endpoint' }, true)
        }
        return
      }
      const explicitYear = getExplicitInstallYear(entity)
      const year = getEffectiveInstallYear(project, entity, inheritedYear)
      const entityTarget: InstallDateTarget =
        kind === 'panel'
          ? { id: entity.id, type: 'panel' }
          : kind === 'endpoint' && 'endpoints' in entity
            ? { id: entity.id, type: 'circuit' }
            : kind === 'protection'
              ? { id: entity.id, type: 'protection' }
              : kind === 'trunkDevice'
                ? { id: entity.id, type: 'trunkDevice' }
                : { id: entity.id, type: 'endpoint' }
      const dateSource = explicitYear != null ? entityTarget : inheritedSource

      if (kind === 'panel') {
        if (explicitYear != null) directPanelYears.push(year)
        return
      }
      if (kind === 'protection') {
        pushBlocker(year, { id: entity.id, kind: 'protection' })
      } else if (kind === 'trunkDevice') {
        pushBlocker(year, { id: entity.id, kind: 'trunkDevice' })
      } else if (kind === 'endpoint') {
        if ('endpoints' in entity) {
          for (const endpoint of entity.endpoints) {
            // A circuit date is inherited only by endpoints without a more specific
            // override. Recording the parent year here made the later endpoint visit
            // look like a conflicting date and fragmented adjacent branch groups.
            const endpointYear = getEffectiveInstallYear(project, endpoint, year)
            pushBlocker(
              endpointYear,
              { id: endpoint.id, kind: 'endpoint' },
              isInstallationDateSuppressed(endpoint)
            )
          }
        } else {
          pushBlocker(year, { id: entity.id, kind: 'endpoint' })
        }
      }
      if (kind === 'endpoint' && isEndpointEntity(entity)) {
        const linkedPanel =
          entity.symbol === 'panel_distribution' && entity.panelId
            ? findPanelInProject(project, entity.panelId)
            : entity.symbol === 'panel_distribution'
              ? findPanelByNameInProject(project, entity.label)
              : undefined
        const linkedPanelExplicitYear = getExplicitInstallYear(linkedPanel)
        if (linkedPanel && linkedPanelExplicitYear != null) {
          pushItem(
            getEffectiveInstallYear(project, linkedPanel),
            { id: entity.id, kind: 'endpoint' },
            { forceSingle: true }
          )
          return
        }
      }

      const inheritedOverrideYear =
        explicitYear == null &&
        inheritedYear != null &&
        getInstallYearFrameYear(inheritedYear) !== getInstallYearFrameYear(panelYear)
      const redundantExplicitYear =
        explicitYear != null &&
        inheritedYear != null &&
        inheritedSource != null &&
        getInstallYearFrameYear(explicitYear) === getInstallYearFrameYear(inheritedYear)
      if (redundantExplicitYear || (explicitYear == null && !inheritedOverrideYear)) return

      if (kind === 'protection') {
        pushItem(year, { id: entity.id, kind: 'protection' }, {
          targets: dateSource ? [dateSource] : undefined,
        })
      } else if (kind === 'trunkDevice') {
        pushItem(year, { id: entity.id, kind: 'trunkDevice' }, {
          targets: dateSource ? [dateSource] : undefined,
        })
      } else if (kind === 'endpoint') {
        if ('endpoints' in entity) {
          for (const endpoint of entity.endpoints) {
            if (isInstallationDateSuppressed(endpoint)) continue
            const endpointYear = getEffectiveInstallYear(project, endpoint, year)
            if (getInstallYearFrameYear(endpointYear) === getInstallYearFrameYear(year)) {
              pushItem(year, { id: endpoint.id, kind: 'endpoint' }, {
                targets: dateSource ? [dateSource] : undefined,
                expandedFromParent: true,
              })
            }
          }
        } else if (explicitYear != null) {
          pushItem(year, { id: entity.id, kind: 'endpoint' }, {
            targets: [entityTarget],
          })
        }
      }
    }
  )

  for (const { device, feedScope } of panelLayout.supplyDevices ?? []) {
    if (feedScope === 'shared') continue
    const explicitYear = getExplicitInstallYear(device)
    if (explicitYear == null) continue
    pushItem(
      getEffectiveInstallYear(project, device),
      { id: device.id, kind: 'trunkDevice' },
      { labelPlacement: 'supplyProtection' }
    )
  }

  for (const { device } of panelLayout.groundDevices ?? []) {
    const explicitYear = getExplicitInstallYear(device)
    if (explicitYear == null) continue
    pushItem(getEffectiveInstallYear(project, device), { id: device.id, kind: 'trunkDevice' })
  }

  const addLinkedPanelSymbolMarkers = (panels: Panel[]) => {
    for (const panel of panels) {
      const explicitYear = getExplicitInstallYear(panel)
      if (explicitYear != null) {
        const link = resolvePanelSupplyLinkForPanel(project, panel.id)
        if (link?.sourcePanel.id === panelLayout.panel.id && link.sourcePanelEndpoint) {
          pushItem(
            getEffectiveInstallYear(project, panel),
            {
              id: link.sourcePanelEndpoint.id,
              kind: 'endpoint',
            },
            { forceSingle: true }
          )
        }
      }
      addLinkedPanelSymbolMarkers(panel.subPanels)
    }
  }
  addLinkedPanelSymbolMarkers(getProjectElectricalPanels(project))

  for (const link of resolvePanelSupplyLinksForSourcePanel(project, panelLayout.panel)) {
    const targetYear = getExplicitInstallYear(link.targetPanel)
    if (targetYear == null) continue
    const symbolElement = panelLayout.elements.find(
      (element) =>
        element.id === `subpanel-symbol-${link.protection.id}` && element.type === 'endpoint'
    )
    if (!symbolElement && !link.sourcePanelEndpoint) continue
    const item = symbolElement
      ? { id: symbolElement.id, kind: 'panelSymbol' as const }
      : { id: link.sourcePanelEndpoint!.id, kind: 'endpoint' as const }
    pushItem(getEffectiveInstallYear(project, link.targetPanel), item, {
      forceSingle: true,
      targets: [{ id: link.targetPanel.id, type: 'panel' }],
    })
  }

  const frames: DateFrame[] = []
  const frameYears = [
    ...new Set(candidates.map((candidate) => getInstallYearFrameYear(candidate.year))),
  ]
  for (const year of frameYears) {
    const sameYear = candidates
      .filter((candidate) => getInstallYearFrameYear(candidate.year) === year)
      .sort((a, b) => a.bounds.y - b.bounds.y || a.bounds.x - b.bounds.x)
    const forcedSingle = sameYear.filter((candidate) => candidate.forceSingle)
    const groupableSameYear = sameYear.filter((candidate) => !candidate.forceSingle)
    const groups: ResolvedFrameItem[][] = []

    for (const candidate of groupableSameYear) {
      const targetGroup = groups.find((group) => {
        const proposed = [...group, candidate.item]
        const proposedItemKeys = new Set(proposed.map((item) => `${item.kind}:${item.id}`))
        // Group with the actual symbol geometry. Labels and visual padding belong to the
        // final frame; using them here fragments a clean run of equally dated branches.
        const proposedBounds = computeEendraadFrameBounds({
          items: proposed,
          panelLayout,
          getEndpointById: getEndpoint,
          padding: 0,
          includeEndpointLabels: false,
        })
        if (!proposedBounds) return false
        // Any overlap with a differently dated item rejects the group; requiring full
        // containment let frames cut through items that are not part of the date.
        return (
          !candidates.some((other) => {
            const otherFrameYear = getInstallYearFrameYear(other.year)
            if (otherFrameYear === year) return false
            if (proposedItemKeys.has(`${other.item.kind}:${other.item.id}`)) return false
            return rectsOverlap(proposedBounds, other.relationBounds)
          }) &&
          !blockers.some((blocker) => {
            if (proposedItemKeys.has(`${blocker.item.kind}:${blocker.item.id}`)) return false
            if (!blocker.unmarked && getInstallYearFrameYear(blocker.year) === year) return false
            return rectsOverlap(proposedBounds, blocker.bounds)
          })
        )
      })
      if (targetGroup) {
        targetGroup.push(candidate.item)
      } else {
        groups.push([candidate.item])
      }
    }

    forcedSingle.forEach((candidate, index) => {
      frames.push({
        id: `${panelLayout.panel.id}-${year}-linked-panel-${index}`,
        year,
        label: formatInstallYearLabel(year, t),
        color: installYearColor(year, monochrome, project.project.installDateColors),
        itemCount: 1,
        relationBounds: candidate.relationBounds,
        labelPlacement: candidate.labelPlacement,
        targets:
          candidate.targets ??
          (candidate.item.kind === 'panelSymbol'
            ? []
            : [{ id: candidate.item.id, type: 'endpoint' }]),
        ...candidate.bounds,
      })
    })

    groups.forEach((items, index) => {
      const oldInstallGroup = isOldInstallYear(year)
      const itemHasMoreSpecificDifferentDateCandidate = (item: ResolvedFrameItem) => {
        const hasDirectCurrentCandidate = candidates.some(
          (candidate) =>
            candidate.item.id === item.id &&
            candidate.item.kind === item.kind &&
            getInstallYearFrameYear(candidate.year) === year &&
            candidate.expandedFromParent !== true
        )
        if (hasDirectCurrentCandidate) return false
        return candidates.some(
          (candidate) =>
            candidate.item.id === item.id &&
            candidate.item.kind === item.kind &&
            getInstallYearFrameYear(candidate.year) !== year &&
            candidate.expandedFromParent !== true
        )
      }
      const groupingBounds = computeEendraadFrameBounds({
        items,
        panelLayout,
        getEndpointById: getEndpoint,
        includeEndpointLabels: false,
      })
      const bounds = oldInstallGroup
        ? computeEendraadFrameBounds({
            items,
            panelLayout,
            getEndpointById: getEndpoint,
            includeEndpointLabels: false,
          })
        : groupingBounds
      const relationBounds = computeEendraadFrameBounds({
        items,
        panelLayout,
        getEndpointById: getEndpoint,
        padding: 0,
        includeEndpointLabels: false,
      })
      if (!bounds) return
      frames.push({
        id: `${panelLayout.panel.id}-${year}-${index}`,
        year,
        label: formatInstallYearLabel(year, t),
        color: installYearColor(year, monochrome, project.project.installDateColors),
        itemCount: items.length,
        relationBounds: relationBounds ?? bounds,
        targets: items.reduce<InstallDateTarget[]>((targets, item) => {
          if (item.kind === 'ground' || item.kind === 'panelSymbol') return targets
          if (itemHasMoreSpecificDifferentDateCandidate(item)) return targets
          const candidateTargets = candidates
            .filter(
              (candidate) =>
                candidate.item.id === item.id &&
                candidate.item.kind === item.kind &&
                getInstallYearFrameYear(candidate.year) === year
            )
            .flatMap((candidate) => candidate.targets ?? [])
          const targetsToAdd =
            candidateTargets.length > 0
              ? candidateTargets
              : [{ id: item.id, type: item.kind as InstallDateTarget['type'] }]
          for (const target of targetsToAdd) {
            if (
              !targets.some(
                (existing) => existing.id === target.id && existing.type === target.type
              )
            ) {
              targets.push(target)
            }
          }
          return targets
        }, []),
        ...bounds,
      })
    })
  }

  for (const year of directPanelYears) {
    frames.push({
      id: `${panelLayout.panel.id}-${year}-panel`,
      year,
      label: formatInstallYearLabel(year, t),
      color: installYearColor(year, monochrome, project.project.installDateColors),
      itemCount: 2,
      borderless: true,
      labelPlacement: 'panel',
      targets: [{ id: panelLayout.panel.id, type: 'panel' }],
      x: panelLayout.frame.x,
      y: panelLayout.frame.y,
      width: panelLayout.frame.width,
      height: panelLayout.frame.height,
    })
  }

  return placeFrameLabels(shrinkFramePaddingCollisions(frames), panelLayout, wireSegments)
}

export interface InstallDateFrameDrawing {
  drawsBorder: boolean
  relationLine: [number, number, number, number] | null
  labelX: number
  labelY: number
  textWidth: number
  fontSize: number
}

/** Geometry shared by the canvas overlay and the PDF export of install dates. */
export function resolveInstallDateFrameDrawing(frame: DateFrame): InstallDateFrameDrawing {
  const isSingle = frame.itemCount <= 1
  const drawsRelationLine = !frame.borderless && (isSingle || isOldInstallYear(frame.year))
  const fontSize = 11
  const textWidth = frame.labelWidth ?? estimateOverlayTextWidth(frame.label, fontSize)
  const labelX = frame.labelX ?? frame.x + frame.width - textWidth
  const labelY = frame.labelY ?? frame.y - (isSingle ? 13 : 20)
  const labelRect = {
    x: labelX,
    y: labelY + 1,
    width: Math.min(textWidth, estimateRelationTextWidth(frame.label, fontSize)),
    height: fontSize + 2,
  }
  const relationBounds = frame.relationBounds ?? {
    x: frame.x,
    y: frame.y,
    width: frame.width,
    height: frame.height,
  }
  const relationLine =
    drawsRelationLine && rectGap(labelRect, relationBounds) > RELATION_LINE_FREE_GAP
      ? clippedRelationLine(
          labelRect,
          relationBounds
        )
      : null
  return {
    drawsBorder: !isSingle && !frame.borderless,
    relationLine,
    labelX,
    labelY,
    textWidth,
    fontSize,
  }
}

const NO_WIRE_SEGMENTS: readonly WireSegment[] = []

const InstallDateOverlay = memo(function InstallDateOverlay({
  project,
  layout,
  wireSegments = NO_WIRE_SEGMENTS,
  visible,
  monochrome,
  selectionEnabled,
  onSelectFrame,
}: InstallDateOverlayProps) {
  const { t } = useTranslation()
  const frames = useMemo(() => {
    if (!visible || !layout) return []
    const inheritance = buildInstallDateInheritanceIndex(project)
    return layout.panels.flatMap((panelLayout) =>
      buildDateFramesForPanel(project, panelLayout, monochrome, t, inheritance, wireSegments)
    )
  }, [layout, monochrome, project, t, visible, wireSegments])

  if (!visible || frames.length === 0) return null

  const interactive = isInstallDateOverlayInteractive(selectionEnabled, onSelectFrame)

  return (
    <Group listening={interactive} name="install-date-overlay">
      {frames.map((frame) => {
        const { drawsBorder, relationLine, labelX, labelY, textWidth, fontSize } =
          resolveInstallDateFrameDrawing(frame)
        const hitPad = 7
        const borderHits = [
          {
            x: frame.x - hitPad,
            y: frame.y - hitPad,
            width: frame.width + hitPad * 2,
            height: hitPad * 2,
          },
          {
            x: frame.x - hitPad,
            y: frame.y + frame.height - hitPad,
            width: frame.width + hitPad * 2,
            height: hitPad * 2,
          },
          {
            x: frame.x - hitPad,
            y: frame.y - hitPad,
            width: hitPad * 2,
            height: frame.height + hitPad * 2,
          },
          {
            x: frame.x + frame.width - hitPad,
            y: frame.y - hitPad,
            width: hitPad * 2,
            height: frame.height + hitPad * 2,
          },
        ]
        const selectFrame = (event: KonvaEventObject<MouseEvent | TouchEvent>) => {
          const button = 'button' in event.evt ? event.evt.button : undefined
          if (!interactive || !onSelectFrame || !isPrimaryInstallDateFrameClick(button)) return
          event.cancelBubble = true
          onSelectFrame({
            targets: frame.targets,
            year: frame.year,
            bounds: { x: frame.x, y: frame.y, width: frame.width, height: frame.height },
          })
        }
        return (
          <Group key={frame.id} listening={interactive}>
            {drawsBorder ? (
              <>
                <Rect
                  x={frame.x}
                  y={frame.y}
                  width={frame.width}
                  height={frame.height}
                  stroke={frame.color}
                  strokeWidth={1.5}
                  dash={[7, 5]}
                  opacity={0.55}
                  cornerRadius={4}
                  listening={false}
                />
                {borderHits.map((hit, index) => (
                  <Rect
                    key={index}
                    {...hit}
                    fill="transparent"
                    onClick={selectFrame}
                    onTap={selectFrame}
                  />
                ))}
              </>
            ) : null}
            {relationLine ? (
              <Line
                points={relationLine}
                stroke={frame.color}
                strokeWidth={1}
                dash={[4, 3]}
                opacity={0.75}
                listening={false}
              />
            ) : null}
            <Text
              x={labelX}
              y={labelY}
              text={frame.label}
              fill={frame.color}
              fontSize={fontSize}
              width={textWidth}
              align="right"
              fontStyle="600"
              opacity={0.72}
              onClick={selectFrame}
              onTap={selectFrame}
            />
          </Group>
        )
      })}
    </Group>
  )
})

export default InstallDateOverlay
