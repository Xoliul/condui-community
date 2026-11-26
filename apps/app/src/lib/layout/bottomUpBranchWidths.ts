import { MULTI_SOCKET_OFFSET } from '@/components/canvas/eendraad/canvasSymbols'
import { getScopedConductorMarkGap } from './conductorMarkSpacing'
import {
  DOMOTICA_BASE_HEIGHT,
  DOMOTICA_BRANCH_LEAD,
  DOMOTICA_BOX_WIDTH,
  DOMOTICA_MAX_ENDPOINT_OUTPUTS,
  DOMOTICA_MIN_ENDPOINT_OUTPUTS,
  DOMOTICA_OUTPUT_SPACING,
} from '@/components/canvas/eendraad/canvasSymbols'
import { DOMOTICA_CHILD_LABEL_GAP } from '@/lib/domoticaLayout'
import { getDomoticaRowDisplayLabel } from '@/lib/eendraad/domoticaRowLabel'
import { getDomoticaBusRowLabelMetrics } from '@/lib/eendraad/domoticaBusRowLabel'
import { getVisibleCertificationLabelParts } from '@/lib/certificationLabels'
import { getVisibleConversionLabelParts, getVisibleEndpointNoteText } from '@/lib/conversionLabels'
import { getScopedControlLinkNote } from '@/lib/controlLink/controlLinkNoteContext'
import { getEndpointNoteMinimumLeftX } from '@/lib/eendraad/endpointNoteLabelCollision'
import { getDomoticaNoteBounds } from '@/lib/eendraad/domoticaNotes'
import { getControlButtonAnnotationBounds } from '@/lib/eendraad/controlButtonLabels'
import { measureSymbolLabelTextWidth } from '@/lib/symbolLabelTextWidth'
import type { Endpoint } from '@/types/schema'
import {
  getHorizontalDomoticaBodyWidth,
  getHorizontalDomoticaChildOffset,
  getHorizontalDomoticaOutputCount,
  isChildOfHorizontalDomotica,
  isHorizontalDomotica,
  DOMOTICA_HORIZONTAL_COLUMN_WIDTH,
} from './domoticaHorizontalGeometry'

/** Keeps consecutive inverter/solar labels readable when they are rendered below the branch. */
export const SOLAR_SEQUENCE_ENDPOINT_SPACING = 50

function isSolarSequenceEndpoint(endpoint: Endpoint | undefined): boolean {
  return endpoint?.symbol === 'inverter' || endpoint?.symbol === 'solar_panel'
}

function isRightSideBranchLabel(endpoint: Endpoint | undefined, isBranchEnd: boolean): boolean {
  return Boolean(
    isBranchEnd &&
      (endpoint?.symbol === 'solar_panel' || endpoint?.symbol === 'battery' || endpoint?.symbol === 'ev')
  )
}

const CONTROL_LINK_NOTE_FONT_SIZE = 8
const CONTROL_LINK_NOTE_NEXT_GAP = 8
const CONTROL_LINK_NOTE_NEXT_HALF_SYMBOL = 15
const ENDPOINT_NOTE_FONT_SIZE = 8
const ENDPOINT_NOTE_NEXT_GAP = 8
const ENDPOINT_SYMBOL_HALF_WIDTH = 15

/**
 * Smallest X a following endpoint may take so the control-link note painted under `endpoint`
 * (clamped clear of the trunk wire, like other bottom notes) never reaches it.
 */
function getControlLinkNoteClearX(endpoint: Endpoint | undefined, x: number): number | undefined {
  if (!endpoint || endpoint.domoticaChildProps) return undefined
  const text = getScopedControlLinkNote(endpoint.id)
  if (!text) return undefined
  const width = measureSymbolLabelTextWidth(text, 'Figtree', CONTROL_LINK_NOTE_FONT_SIZE)
  const left = x + Math.max(-width / 2, getEndpointNoteMinimumLeftX(x, 0))
  return left + width + CONTROL_LINK_NOTE_NEXT_GAP + CONTROL_LINK_NOTE_NEXT_HALF_SYMBOL
}

/** X offset from branch.branchX for each endpoint (includes appliance-after-socket gap). */
export function getEndpointXOffsets(
  branchEndpoints: Endpoint[],
  leadIn: number,
  endpointSpacing: number,
  applianceAfterSocketGap: number
): number[] {
  const result: number[] = []
  // Wires toggled to show conductor marks get room for them.
  let x =
    (isSolarSequenceEndpoint(branchEndpoints[0])
      ? Math.max(leadIn, SOLAR_SEQUENCE_ENDPOINT_SPACING)
      : leadIn) + (branchEndpoints[0] ? getScopedConductorMarkGap(branchEndpoints[0].id) : 0)
  for (let i = 0; i < branchEndpoints.length; i++) {
    result.push(x)
    const ep = branchEndpoints[i]
    const next = branchEndpoints[i + 1]
    if (next) {
      const resolvedEndpointSpacing =
        isSolarSequenceEndpoint(ep) && isSolarSequenceEndpoint(next)
          ? Math.max(endpointSpacing, SOLAR_SEQUENCE_ENDPOINT_SPACING)
          : endpointSpacing
      const extra =
        ep?.type === 'socket' && next?.type === 'fixed_appliance' ? applianceAfterSocketGap : 0
      // Multi-gang sockets paint extra arcs to the right; keep the next symbol clear of them.
      const socketExtra =
        ep?.type === 'socket'
          ? Math.max(0, (ep.socketProps?.socketCount ?? 1) - 1) * MULTI_SOCKET_OFFSET
          : 0
      const endpointNoteText = ep && !isRightSideBranchLabel(ep, i === branchEndpoints.length - 1)
        ? getVisibleEndpointNoteText(ep)
        : ''
      const endpointNoteWidth = endpointNoteText
        ? measureSymbolLabelTextWidth(endpointNoteText, 'Figtree', ENDPOINT_NOTE_FONT_SIZE)
        : 0
      const endpointNoteOffset = socketExtra / 2
      const endpointNoteLeft = endpointNoteText
        ? x + endpointNoteOffset +
          Math.max(-endpointNoteWidth / 2, getEndpointNoteMinimumLeftX(x, 0))
        : undefined
      const endpointNoteRight =
        endpointNoteLeft == null ? undefined : endpointNoteLeft + endpointNoteWidth
      const buttonAnnotation = ep && getControlButtonAnnotationBounds(ep, x, 0, 0)
      const nextEndpointNoteText = isRightSideBranchLabel(next!, i + 1 === branchEndpoints.length - 1)
        ? ''
        : getVisibleEndpointNoteText(next!)
      const nextEndpointNoteWidth = nextEndpointNoteText
        ? measureSymbolLabelTextWidth(nextEndpointNoteText, 'Figtree', ENDPOINT_NOTE_FONT_SIZE)
        : 0
      const nextSocketExtra =
        next?.type === 'socket'
          ? Math.max(0, (next.socketProps?.socketCount ?? 1) - 1) * MULTI_SOCKET_OFFSET
          : 0
      const clearEndpointNote = endpointNoteRight == null
        ? Number.NEGATIVE_INFINITY
        : endpointNoteRight + ENDPOINT_NOTE_NEXT_GAP +
          Math.max(
            ENDPOINT_SYMBOL_HALF_WIDTH + nextSocketExtra,
            nextEndpointNoteWidth / 2 - nextSocketExtra / 2
          )
      const clearPreviousSymbolForNextNote = nextEndpointNoteWidth > 0
        ? x + socketExtra + ENDPOINT_SYMBOL_HALF_WIDTH + ENDPOINT_NOTE_NEXT_GAP +
          nextEndpointNoteWidth / 2 - nextSocketExtra / 2
        : Number.NEGATIVE_INFINITY
      x = Math.max(
        x + resolvedEndpointSpacing + extra + socketExtra + getScopedConductorMarkGap(next!.id),
        getControlLinkNoteClearX(ep, x) ?? Number.NEGATIVE_INFINITY,
        clearEndpointNote,
        clearPreviousSymbolForNextNote,
        buttonAnnotation ? buttonAnnotation.right + ENDPOINT_NOTE_NEXT_GAP + Math.max(ENDPOINT_SYMBOL_HALF_WIDTH, nextEndpointNoteWidth / 2) : -Infinity,
        (() => {
          const nextAnnotation = getControlButtonAnnotationBounds(next, 0, 0, -100000)
          return nextAnnotation ? x + socketExtra + ENDPOINT_SYMBOL_HALF_WIDTH + ENDPOINT_NOTE_NEXT_GAP - nextAnnotation.left : -Infinity
        })(),
      )
    }
  }
  return result
}

export function getDomoticaRowChainIndex(branchEndpoints: Endpoint[], endpoint: Endpoint): number {
  const ref = endpoint.domoticaChildProps
  if (!ref) return 0

  const rowEndpoints = branchEndpoints.filter(
    (candidate) =>
      candidate.domoticaChildProps?.parentEndpointId === ref.parentEndpointId &&
      candidate.domoticaChildProps.outputIndex === ref.outputIndex
  )
  const index = rowEndpoints.findIndex((candidate) => candidate.id === endpoint.id)
  return index >= 0 ? index : 0
}

/**
 * X offsets used to paint endpoints on a branch.
 *
 * Domotica children are arranged in vertical output rows, so children on
 * different rows share an X position instead of advancing like an ordinary
 * horizontal endpoint chain.
 */
export function getEndpointLayoutXOffsets(
  branchEndpoints: Endpoint[],
  leadIn: number,
  endpointSpacing: number,
  applianceAfterSocketGap: number
): number[] {
  return getEndpointLayoutOffsets(
    branchEndpoints,
    leadIn,
    endpointSpacing,
    applianceAfterSocketGap
  ).map((offset) => offset.x)
}

export interface EndpointLayoutOffset {
  x: number
  /** Vertical offset from the owning circuit branch wire. */
  y: number
}

const DOMOTICA_NESTED_CLEARANCE = 6
const DOMOTICA_LABEL_FONT_SIZE = 11
const DOMOTICA_LABEL_SAFETY = 2

function getDomoticaEndpointCount(endpoint: Endpoint): number {
  return Math.max(
    DOMOTICA_MIN_ENDPOINT_OUTPUTS,
    Math.min(
      DOMOTICA_MAX_ENDPOINT_OUTPUTS,
      Math.trunc(endpoint.domoticaProps?.endpointCount ?? DOMOTICA_MIN_ENDPOINT_OUTPUTS)
    )
  )
}

/**
 * Resolve the complete recursive Domotica branch geometry.
 *
 * A nested module keeps the incoming output row as its bottom row and grows
 * upward. Before placing its box, move it right until the box clears painted
 * sibling symbols and their visible row labels.
 */
export function getEndpointLayoutOffsets(
  branchEndpoints: Endpoint[],
  leadIn: number,
  endpointSpacing: number,
  applianceAfterSocketGap: number,
  symbolSize = 30
): EndpointLayoutOffset[] {
  const offsets = getEndpointXOffsets(
    branchEndpoints,
    leadIn,
    endpointSpacing,
    applianceAfterSocketGap
  )
  const result = branchEndpoints.map((_, index) => ({ x: offsets[index] ?? leadIn, y: 0 }))
  const indexById = new Map(branchEndpoints.map((endpoint, index) => [endpoint.id, index]))
  const endpointById = new Map(branchEndpoints.map((endpoint) => [endpoint.id, endpoint]))
  const paintedRects: Array<{ id: string; left: number; right: number; top: number; bottom: number; hasButtonAnnotation: boolean }> = []

  const addPaintedRect = (endpoint: Endpoint, x: number, y: number, includeLabel: boolean) => {
    const isModule = endpoint.symbol === 'domotica'
    const variableHeight = isModule
      ? Math.max(0, getDomoticaEndpointCount(endpoint) - 1) * DOMOTICA_OUTPUT_SPACING
      : 0
    const socketExtra =
      endpoint.type === 'socket'
        ? Math.max(0, (endpoint.socketProps?.socketCount ?? 1) - 1) * MULTI_SOCKET_OFFSET
        : 0
    let right = x + (isModule ? DOMOTICA_BOX_WIDTH / 2 : symbolSize / 2 + socketExtra)
    if (includeLabel && endpoint.label?.trim()) {
      const measuredLabelWidth = getDomoticaBusRowLabelMetrics(endpoint)?.width ??
        (measureSymbolLabelTextWidth(getDomoticaRowDisplayLabel(endpoint, { code: '', endpoints: branchEndpoints }), 'Figtree', DOMOTICA_LABEL_FONT_SIZE) +
        DOMOTICA_LABEL_SAFETY)
      right = Math.max(
        right,
        isModule
          ? x - DOMOTICA_BOX_WIDTH / 2 + measuredLabelWidth
          : x + symbolSize / 2 + DOMOTICA_CHILD_LABEL_GAP + measuredLabelWidth
      )
    }
    const note = getDomoticaNoteBounds(endpoint, x, y, 0)
    const buttonAnnotation = getControlButtonAnnotationBounds(endpoint, x, y, 0)
    paintedRects.push({
      id: endpoint.id,
      hasButtonAnnotation: !!buttonAnnotation,
      left: x - (isModule ? DOMOTICA_BOX_WIDTH / 2 : symbolSize / 2),
      right: Math.max(right, note?.right ?? right, buttonAnnotation?.right ?? right),
      top: y - variableHeight - (isModule ? DOMOTICA_BASE_HEIGHT / 2 : symbolSize / 2),
      bottom: Math.max(note?.bottom ?? -Infinity, buttonAnnotation?.bottom ?? -Infinity,
        y +
        (isModule && includeLabel && endpoint.domoticaChildProps
          ? DOMOTICA_BASE_HEIGHT / 2 + 23
          : isModule
            ? DOMOTICA_BASE_HEIGHT / 2
            : symbolSize / 2)),
    })
  }

  const placeModule = (module: Endpoint, moduleX: number, inputY: number, ancestry: Set<string>) => {
    if (ancestry.has(module.id)) return
    const moduleIndex = indexById.get(module.id)
    if (moduleIndex == null) return
    result[moduleIndex] = { x: moduleX, y: inputY }

    const nextAncestry = new Set(ancestry).add(module.id)
    const count = getDomoticaEndpointCount(module)
    const firstOutputY = inputY - Math.max(0, count - 1) * DOMOTICA_OUTPUT_SPACING
    const directChildren = branchEndpoints.filter(
      (endpoint) => endpoint.domoticaChildProps?.parentEndpointId === module.id
    )
    const rows = new Map<number, Endpoint[]>()
    for (const child of directChildren) {
      const row = child.domoticaChildProps?.outputIndex ?? 0
      const rowChildren = rows.get(row) ?? []
      rowChildren.push(child)
      rows.set(row, rowChildren)
    }

    if (isHorizontalDomotica(module)) {
      // Outputs run along the top edge: a child stands above its output column and a chain
      // continues upward, so no row shifting or label clearance applies.
      for (const [row, rowChildren] of rows) {
        rowChildren.forEach((child, chainIndex) => {
          const childIndex = indexById.get(child.id)
          if (childIndex == null) return
          const offset = getHorizontalDomoticaChildOffset(row, chainIndex)
          result[childIndex] = { x: moduleX + offset.x, y: inputY + offset.y }
          if (child.symbol !== 'domotica') {
            addPaintedRect(child, moduleX + offset.x, inputY + offset.y, false)
          }
        })
      }
    }

    for (const [row, rowChildren] of isHorizontalDomotica(module) ? [] : rows) {
      let rowShiftX = 0
      rowChildren.forEach((child, chainIndex) => {
        const childIndex = indexById.get(child.id)
        if (childIndex == null) return
        const previous = rowChildren[chainIndex - 1]
        const previousOffset = previous && result[indexById.get(previous.id)!]
        const previousAnnotation = previous && previousOffset && getControlButtonAnnotationBounds(previous, previousOffset.x, previousOffset.y, 0)
        let childX = moduleX + DOMOTICA_BOX_WIDTH / 2 + DOMOTICA_BRANCH_LEAD + chainIndex * endpointSpacing + rowShiftX
        const childY = firstOutputY + row * DOMOTICA_OUTPUT_SPACING
        const ownAnnotation = getControlButtonAnnotationBounds(child, childX, childY, 0)
        const childTop = childY - symbolSize / 2
        const childBottom = Math.max(childY + symbolSize / 2, ownAnnotation?.bottom ?? -Infinity)
        const centeredAnnotation = getControlButtonAnnotationBounds(child, 0, 0, -100000)
        const halfWidth = Math.max(symbolSize / 2, centeredAnnotation ? -centeredAnnotation.left : 0)
        const obstacleRight = paintedRects.reduce((right, rect) => (ownAnnotation || rect.hasButtonAnnotation) && rect.bottom > childTop && rect.top < childBottom
          ? Math.max(right, rect.right) : right, -Infinity)
        const shiftedX = Math.max(childX,
          Number.isFinite(obstacleRight) ? obstacleRight + DOMOTICA_NESTED_CLEARANCE + halfWidth : -Infinity,
          previousAnnotation ? previousAnnotation.right + DOMOTICA_NESTED_CLEARANCE + halfWidth : -Infinity)
        rowShiftX += shiftedX - childX
        childX = shiftedX
        result[childIndex] = { x: childX, y: childY }
      })
      rowChildren.forEach((child, chainIndex) => {
        if (child.symbol === 'domotica') return
        const childOffset = result[indexById.get(child.id)!]!
        addPaintedRect(child, childOffset.x, childOffset.y, chainIndex === rowChildren.length - 1)
      })
    }

    const nestedModules = directChildren.filter((child) => child.symbol === 'domotica')
    for (const nested of nestedModules) {
      const nestedIndex = indexById.get(nested.id)
      if (nestedIndex == null) continue
      const initial = result[nestedIndex]!
      const nestedVariableHeight =
        Math.max(0, getDomoticaEndpointCount(nested) - 1) * DOMOTICA_OUTPUT_SPACING
      const top = initial.y - nestedVariableHeight - DOMOTICA_BASE_HEIGHT / 2
      const nestedNote = getDomoticaNoteBounds(nested, initial.x, initial.y, 0)
      const nestedBusAddress = getControlButtonAnnotationBounds(nested, initial.x, initial.y, 0)
      const bottom = Math.max(initial.y + DOMOTICA_BASE_HEIGHT / 2,
        nestedNote?.bottom ?? -Infinity, nestedBusAddress?.bottom ?? -Infinity)
      const leftExtent = Math.max(DOMOTICA_BOX_WIDTH / 2,
        nestedNote ? (nestedNote.right - nestedNote.left) / 2 : 0,
        nestedBusAddress ? (nestedBusAddress.right - nestedBusAddress.left) / 2 : 0)
      const obstacleRight = paintedRects.reduce(
        (right, rect) =>
          rect.id !== nested.id && rect.bottom >= top && rect.top <= bottom
            ? Math.max(right, rect.right)
            : right,
        Number.NEGATIVE_INFINITY
      )
      const nestedX = Number.isFinite(obstacleRight)
        ? Math.max(
            initial.x,
            obstacleRight + DOMOTICA_NESTED_CLEARANCE + leftExtent
          )
        : initial.x
      result[nestedIndex] = { x: nestedX, y: initial.y }
      const nestedRow = rows.get(nested.domoticaChildProps?.outputIndex ?? 0) ?? []
      addPaintedRect(nested, nestedX, initial.y, nestedRow.at(-1)?.id === nested.id)
      placeModule(nested, nestedX, initial.y, nextAncestry)
    }
  }

  const rootModules = branchEndpoints.filter((endpoint) => {
    if (endpoint.symbol !== 'domotica') return false
    const parent = endpoint.domoticaChildProps
      ? endpointById.get(endpoint.domoticaChildProps.parentEndpointId)
      : undefined
    return parent?.symbol !== 'domotica'
  })
  for (const root of rootModules) {
    const rootIndex = indexById.get(root.id)
    if (rootIndex == null) continue
    const rootOffset = result[rootIndex]!
    addPaintedRect(root, rootOffset.x, rootOffset.y, false)
    placeModule(root, rootOffset.x, rootOffset.y, new Set())
  }

  return result
}

/**
 * Calculate horizontal branch width accounting for multi-socket endpoints and appliance-after-socket gap.
 */
export function calculateBranchWidth(
  branchEndpoints: Endpoint[],
  leadIn: number,
  endpointSpacing: number,
  applianceAfterSocketGap: number
): number {
  const domotica = branchEndpoints.find((ep) => ep.symbol === 'domotica' && !ep.domoticaChildProps)
  if (domotica) {
    const endpointCount = getDomoticaEndpointCount(domotica)
    const layoutOffsets = getEndpointLayoutOffsets(
      branchEndpoints,
      leadIn,
      endpointSpacing,
      applianceAfterSocketGap
    )
    const maxWireReach = branchEndpoints.reduce((right, endpoint, index) => {
      const offset = layoutOffsets[index]?.x ?? leadIn
      const socketExtra =
        endpoint.type === 'socket'
          ? Math.max(0, (endpoint.socketProps?.socketCount ?? 1) - 1) * MULTI_SOCKET_OFFSET
          : 0
      const symbolRight =
        offset +
        (isHorizontalDomotica(endpoint)
          ? getHorizontalDomoticaBodyWidth(getHorizontalDomoticaOutputCount(endpoint)) -
            DOMOTICA_HORIZONTAL_COLUMN_WIDTH / 2
          : endpoint.symbol === 'domotica'
            ? DOMOTICA_BOX_WIDTH / 2
            : 15 + socketExtra)
      const labelRight = endpoint.domoticaChildProps && endpoint.label?.trim() &&
        !isChildOfHorizontalDomotica(endpoint, branchEndpoints)
        ? endpoint.symbol === 'domotica'
          ? offset -
            DOMOTICA_BOX_WIDTH / 2 +
            (getDomoticaBusRowLabelMetrics(endpoint)?.width ??
              measureSymbolLabelTextWidth(getDomoticaRowDisplayLabel(endpoint, { code: '', endpoints: branchEndpoints }), 'Figtree', DOMOTICA_LABEL_FONT_SIZE) +
              DOMOTICA_LABEL_SAFETY)
          : offset +
            15 +
            DOMOTICA_CHILD_LABEL_GAP +
            (getDomoticaBusRowLabelMetrics(endpoint)?.width ??
              measureSymbolLabelTextWidth(getDomoticaRowDisplayLabel(endpoint, { code: '', endpoints: branchEndpoints }), 'Figtree', DOMOTICA_LABEL_FONT_SIZE) +
              DOMOTICA_LABEL_SAFETY)
        : symbolRight
      const noteRight = getDomoticaNoteBounds(endpoint, offset, layoutOffsets[index]?.y ?? 0, 0)?.right ?? symbolRight
      const buttonRight = getControlButtonAnnotationBounds(endpoint, offset, layoutOffsets[index]?.y ?? 0, 0)?.right ?? symbolRight
      return Math.max(right, symbolRight, labelRight, noteRight, buttonRight)
    }, leadIn)
    const outputStackHeight =
      DOMOTICA_BASE_HEIGHT + Math.max(0, endpointCount - 1) * DOMOTICA_OUTPUT_SPACING
    return Math.max(leadIn, maxWireReach, outputStackHeight / 4)
  }

  const count = branchEndpoints.length
  if (count === 0) return leadIn

  const offsets = getEndpointXOffsets(
    branchEndpoints,
    leadIn,
    endpointSpacing,
    applianceAfterSocketGap
  )
  let maxRight = leadIn
  for (let i = 0; i < count; i++) {
    const ep = branchEndpoints[i]
    if (!ep) continue
    const socketExtra =
      ep.type === 'socket'
        ? Math.max(0, (ep.socketProps?.socketCount || 1) - 1) * MULTI_SOCKET_OFFSET
        : 0
    const wideSymbolExtra =
      ep.symbol === 'energy_meter' ||
      ep.symbol === 'transformer' ||
      ep.symbol === 'rectifier' ||
      ep.symbol === 'inverter' ||
      ep.symbol === 'dc_dc_converter'
        ? endpointSpacing
        : 0

    maxRight = Math.max(maxRight, (offsets[i] ?? leadIn) + socketExtra + wideSymbolExtra)
    maxRight = Math.max(maxRight, getControlButtonAnnotationBounds(ep, offsets[i] ?? leadIn, 0, 0)?.right ?? -Infinity)

    const noteText = isRightSideBranchLabel(ep, i === count - 1)
      ? ''
      : getVisibleEndpointNoteText(ep)
    if (noteText) {
      const endpointX = offsets[i] ?? leadIn
      const noteWidth = measureSymbolLabelTextWidth(noteText, 'Figtree', ENDPOINT_NOTE_FONT_SIZE)
      const noteLeft = endpointX + socketExtra / 2 +
        Math.max(-noteWidth / 2, getEndpointNoteMinimumLeftX(endpointX, 0))
      maxRight = Math.max(maxRight, noteLeft + noteWidth)
    }
  }

  // A single regular endpoint keeps its bottom metadata clear of the branch
  // wire. The wire itself must grow with the unbounded label so the trunk,
  // divider, and hitbox move out instead of clipping the rendered text.
  if (count === 1) {
    const ep = branchEndpoints[0]
    const endpointX = offsets[0] ?? leadIn
    const usesRightLabel =
      ep?.symbol === 'solar_panel' || ep?.symbol === 'battery' || ep?.symbol === 'ev'
    if (ep && (ep.type !== 'switch' || getScopedControlLinkNote(ep.id)) && !usesRightLabel) {
      const labelLines = [
        ...getVisibleConversionLabelParts(ep).map((part) => part.text),
        ...getVisibleCertificationLabelParts(ep).map((part) => part.text),
        getVisibleEndpointNoteText(ep),
      ].filter((line) => line.length > 0)
      const socketLabelOffset =
        ep.type === 'socket'
          ? (Math.max(0, (ep.socketProps?.socketCount ?? 1) - 1) * MULTI_SOCKET_OFFSET) / 2
          : 0
      const minimumLeftX = getEndpointNoteMinimumLeftX(endpointX, 0)
      for (const line of labelLines) {
        const lineWidth = measureSymbolLabelTextWidth(line, 'Figtree', 8)
        const lineLeft = endpointX + Math.max(socketLabelOffset - lineWidth / 2, minimumLeftX)
        maxRight = Math.max(maxRight, lineLeft + lineWidth)
      }
    }
  }

  return maxRight
}
